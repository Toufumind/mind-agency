/**
 * GroupProxy — unified group representation in Next.js process.
 *
 * Consolidates ALL group logic:
 *   - Group config (config.json)
 *   - Group members (Agents/ directory)
 *   - Group chat (chat/ directory)
 *   - Group workflow (workflow.yaml)
 *   - Group files (files/ directory)
 *
 * Each group has one proxy instance.
 * Use GroupRegistry to get/create proxies.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR, AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';

// ── Types ─────────────────────────────────────────────────

export interface GroupConfig {
  name: string;
  description?: string;
  owner: string;
  admins: string[];
  announcement?: { title: string; content: string; author: string; timestamp: number };
}

export interface GroupMember {
  name: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
}

export interface ChatMessage {
  from: string;
  date: string;
  body: string;
}

export interface GroupStats {
  memberCount: number;
  messageCount: number;
  lastActivity?: number;
}

// ── Default values ────────────────────────────────────────

const DEFAULT_CONFIG: GroupConfig = {
  name: '',
  owner: '',
  admins: [],
};

// ── GroupProxy class ──────────────────────────────────────

export class GroupProxy {
  readonly name: string;

  private _config: GroupConfig = { ...DEFAULT_CONFIG };
  private _members: GroupMember[] = [];
  private _configLoaded = false;
  private _membersLoaded = false;

  // Workflow cache
  private _workflow: string | null = null;
  private _workflowLoaded = false;
  private _workflowMtime: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  // ── Config ────────────────────────────────────────────

  get config(): GroupConfig {
    return this._config;
  }

  async loadConfig(): Promise<GroupConfig> {
    if (this._configLoaded) return this._config;

    const cached = agentCache.get<GroupConfig>('groupConfig', this.name);
    if (cached) {
      this._config = cached;
      this._configLoaded = true;
      return this._config;
    }

    try {
      const configPath = path.join(GROUPS_DIR, this.name, 'config.json');
      if (fs.existsSync(configPath)) {
        this._config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        agentCache.set('groupConfig', this.name, this._config);
      }
    } catch {}

    this._configLoaded = true;
    return this._config;
  }

  async saveConfig(): Promise<void> {
    try {
      const groupDir = path.join(GROUPS_DIR, this.name);
      if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });

      const configPath = path.join(groupDir, 'config.json');
      const tmp = configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._config, null, 2), 'utf-8');
      fs.renameSync(tmp, configPath);
      agentCache.invalidate('groupConfig', this.name);
    } catch (err) {
      console.error(`[group-proxy] saveConfig(${this.name}):`, err);
    }
  }

  // ── Members ───────────────────────────────────────────

  get members(): GroupMember[] {
    return this._members;
  }

  async loadMembers(): Promise<GroupMember[]> {
    if (this._membersLoaded) return this._members;

    try {
      const agentsDir = path.join(GROUPS_DIR, this.name, 'Agents');
      if (fs.existsSync(agentsDir)) {
        const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
        this._members = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            role: this._config.owner === e.name ? 'owner' :
                  this._config.admins.includes(e.name) ? 'admin' : 'member',
            joinedAt: fs.statSync(path.join(agentsDir, e.name)).mtimeMs,
          }));
      }
    } catch {}

    this._membersLoaded = true;
    return this._members;
  }

  async addMember(agentName: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<boolean> {
    try {
      const memberDir = path.join(GROUPS_DIR, this.name, 'Agents', agentName);
      if (fs.existsSync(memberDir)) return false; // Already a member

      fs.mkdirSync(memberDir, { recursive: true });
      fs.mkdirSync(path.join(memberDir, 'email'), { recursive: true });

      this._members.push({
        name: agentName,
        role,
        joinedAt: Date.now(),
      });

      return true;
    } catch (err) {
      console.error(`[group-proxy] addMember(${this.name}, ${agentName}):`, err);
      return false;
    }
  }

  async removeMember(agentName: string): Promise<boolean> {
    try {
      const memberDir = path.join(GROUPS_DIR, this.name, 'Agents', agentName);
      if (!fs.existsSync(memberDir)) return false;

      fs.rmSync(memberDir, { recursive: true, force: true });
      this._members = this._members.filter(m => m.name !== agentName);

      return true;
    } catch (err) {
      console.error(`[group-proxy] removeMember(${this.name}, ${agentName}):`, err);
      return false;
    }
  }

  isMember(agentName: string): boolean {
    return this._members.some(m => m.name.toLowerCase() === agentName.toLowerCase());
  }

  // ── Chat ──────────────────────────────────────────────

  async getMessages(limit: number = 20): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    try {
      const chatDir = path.join(GROUPS_DIR, this.name, 'chat');
      if (!fs.existsSync(chatDir)) return messages;

      const files = fs.readdirSync(chatDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .slice(-limit);

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(chatDir, file), 'utf-8');
          const blocks = content.split(/\n(?=---\nfrom:)/);
          for (const block of blocks) {
            const match = block.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
            if (match) {
              messages.push({
                from: match[1].trim(),
                date: match[2].trim(),
                body: match[3].trim(),
              });
            }
          }
        } catch {}
      }
    } catch {}

    return messages;
  }

  async sendMessage(from: string, message: string): Promise<boolean> {
    try {
      const chatDir = path.join(GROUPS_DIR, this.name, 'chat');
      if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });

      const timestamp = Date.now();
      const safeFrom = from.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const filename = `${timestamp}_${safeFrom}.md`;
      const content = `---\nfrom: ${from}\ndate: ${new Date().toISOString()}\n---\n\n${message}\n`;

      const tmp = path.join(chatDir, filename + '.tmp');
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, path.join(chatDir, filename));

      return true;
    } catch (err) {
      console.error(`[group-proxy] sendMessage(${this.name}, ${from}):`, err);
      return false;
    }
  }

  // ── Workflow ──────────────────────────────────────────

  async getWorkflow(): Promise<string | null> {
    try {
      const wfPath = path.join(GROUPS_DIR, this.name, 'workflow.yaml');
      if (!fs.existsSync(wfPath)) {
        this._workflow = null;
        this._workflowLoaded = true;
        return null;
      }

      // Check if file has been modified
      const stat = fs.statSync(wfPath);
      if (this._workflowLoaded && this._workflowMtime === stat.mtimeMs) {
        return this._workflow;
      }

      // File changed or not loaded yet
      this._workflow = fs.readFileSync(wfPath, 'utf-8');
      this._workflowMtime = stat.mtimeMs;
      this._workflowLoaded = true;

      return this._workflow;
    } catch {}
    return null;
  }

  async saveWorkflow(yaml: string): Promise<boolean> {
    try {
      const groupDir = path.join(GROUPS_DIR, this.name);
      if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });

      const wfPath = path.join(groupDir, 'workflow.yaml');
      const tmp = wfPath + '.tmp';
      fs.writeFileSync(tmp, yaml, 'utf-8');
      fs.renameSync(tmp, wfPath);

      // Update cache
      this._workflow = yaml;
      this._workflowMtime = fs.statSync(wfPath).mtimeMs;
      this._workflowLoaded = true;

      return true;
    } catch (err) {
      console.error(`[group-proxy] saveWorkflow(${this.name}):`, err);
      return false;
    }
  }

  // ── Files ─────────────────────────────────────────────

  async getFiles(): Promise<string[]> {
    try {
      const filesDir = path.join(GROUPS_DIR, this.name, 'files');
      if (!fs.existsSync(filesDir)) return [];

      return fs.readdirSync(filesDir).filter(f => !f.startsWith('.'));
    } catch {}
    return [];
  }

  async uploadFile(filename: string, content: Buffer): Promise<boolean> {
    try {
      const filesDir = path.join(GROUPS_DIR, this.name, 'files');
      if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

      const filePath = path.join(filesDir, filename);
      fs.writeFileSync(filePath, content);

      return true;
    } catch (err) {
      console.error(`[group-proxy] uploadFile(${this.name}, ${filename}):`, err);
      return false;
    }
  }

  async getFile(filename: string): Promise<Buffer | null> {
    try {
      const filePath = path.join(GROUPS_DIR, this.name, 'files', filename);
      if (!fs.existsSync(filePath)) return null;

      return fs.readFileSync(filePath);
    } catch {}
    return null;
  }

  // ── Stats ─────────────────────────────────────────────

  async getStats(): Promise<GroupStats> {
    const members = await this.loadMembers();
    // taste: don't load 1000 messages just to count — use readdirSync
    const chatDir = path.join(GROUPS_DIR, this.name, 'chat');
    let messageCount = 0;
    let lastActivity: number | undefined;
    if (fs.existsSync(chatDir)) {
      const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort();
      messageCount = files.length;
      if (files.length > 0) {
        const lastFile = fs.readFileSync(path.join(chatDir, files[files.length - 1]), 'utf-8');
        const dateMatch = lastFile.match(/date:\s*(.+)/);
        if (dateMatch) lastActivity = new Date(dateMatch[1].trim()).getTime();
      }
    }

    return { memberCount: members.length, messageCount, lastActivity };
  }

  // ── Existence ─────────────────────────────────────────

  exists(): boolean {
    return fs.existsSync(path.join(GROUPS_DIR, this.name));
  }

  // ── Cleanup ───────────────────────────────────────────

  invalidateCache(): void {
    agentCache.invalidate('groupConfig', this.name);
    this._configLoaded = false;
    this._membersLoaded = false;
    this._workflowLoaded = false;
    this._workflow = null;
    this._workflowMtime = 0;
  }

  destroy(): void {
    this.invalidateCache();
  }
}
