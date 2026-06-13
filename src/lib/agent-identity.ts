/**
 * agent-identity.ts — Agent identity and system prompt building
 *
 * Extracted from AgentProxy to follow Single Responsibility Principle.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR, MCP_DIR, MIND_DIR, default as DATA_DIR, getApiBase, getWsBase } from './data-dir';
import { agentCache } from './cache';
import type { AgentConfig } from './agent-types';

// ── Shared system boundary prompt (canonical source) ──
// Used by both agent-identity.ts and chat.ts. Do not duplicate.
export const SYSTEM_BOUNDARY_PROMPT = `
【能力边界 — L1·L2·L3】
L1-你的领域: 自己的 chat session、.todo、email 收件箱（只看+删）、.mind 记忆。可自由操作。
L2-协议交互: 跟别人沟通用 group_send/group_read/email（写到对方 Agents/<name>/email/）。不要直接写其他 Agent 的文件。
L3-不可碰: 别人的 config.json、chat session、.todo。不要替别人发言。
违反 L2/L3 会破坏团队信任。

【工具速查】
你可以使用以下MCP工具：
- group_send: 向群组发消息
- group_read: 读取群组消息
- email_send: 发送邮件
- workflow_callback: 报告工作流步骤完成结果
- task: 报告任务进度
- learning_query: 查询团队学习记录

文件系统工具（备用）：
- Read/Write/Edit: 文件读写
- Bash: 执行命令

完成工作流任务后，请用 workflow_callback 工具报告结果：
workflow_callback(runId="...", stepId="...", status="COMPLETED", summary="结果摘要", details="详细说明")
始终用中文回复。`;

export class AgentIdentity {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Read agent's CLAUDE.md file
   */
  readClaudeMd(): string {
    const cached = agentCache.get<string>('identity', this.name);
    if (cached !== null) return cached;

    try {
      const file = path.join(AGENTS_DIR, this.name, 'CLAUDE.md');
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8').trim();
        agentCache.set('identity', this.name, content);
        return content;
      }
    } catch (err) {
      console.warn(`[agent-identity] Failed to read CLAUDE.md for ${this.name}:`, err);
    }

    // Fallback: try .claude/CLAUDE.md
    try {
      const claudeMdAlt = path.join(AGENTS_DIR, this.name, '.claude', 'CLAUDE.md');
      if (fs.existsSync(claudeMdAlt)) {
        const content = fs.readFileSync(claudeMdAlt, 'utf-8').trim();
        agentCache.set('identity', this.name, content);
        return content;
      }
    } catch (err) {
      console.warn(`[agent-identity] Failed to read .claude/CLAUDE.md for ${this.name}:`, err);
    }

    return '';
  }

  /**
   * Build agent identity with behavioral config
   */
  buildIdentity(): string {
    const config = this.loadConfig();

    let identity = this.readClaudeMd();
    if (!identity) {
      identity = `你是${this.name}，Mind Agency 团队成员。`;
    }

    // Append behavioral config
    const behavior = config.behavior;
    const behaviorLines: string[] = [];
    if (behavior) {
      if (behavior.style) behaviorLines.push(`- 风格: ${behavior.style}`);
      if (behavior.focus?.length) behaviorLines.push(`- 重点领域: ${behavior.focus.join(', ')}`);
      if (behavior.avoidTopics?.length) behaviorLines.push(`- 避免: ${behavior.avoidTopics.join(', ')}`);
    }
    if (behaviorLines.length > 0) identity += '\n\n【行为偏好】\n' + behaviorLines.join('\n');

    // Append L1/L2/L3 boundaries (from shared constant)
    identity += `\n\n${SYSTEM_BOUNDARY_PROMPT}`;

    return identity;
  }

  /**
   * Get group membership for this agent
   */
  getGroupMembership(): string {
    const cached = agentCache.get<string>('membership', this.name);
    if (cached !== null) return cached;

    const groups: string[] = [];
    if (fs.existsSync(GROUPS_DIR)) {
      for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
        if (!g.isDirectory() || g.name.startsWith('.')) continue;
        const agDir = path.join(GROUPS_DIR, g.name, 'Agents');
        if (!fs.existsSync(agDir)) continue;
        if (fs.readdirSync(agDir, { withFileTypes: true }).some(
          e => e.isDirectory() && e.name.toLowerCase() === this.name.toLowerCase()
        )) {
          groups.push(g.name);
        }
      }
    }

    const result = groups.length > 0 ? `\n你所在的群组: ${groups.join(', ')}` : '';
    agentCache.set('membership', this.name, result);
    return result;
  }

  /**
   * Build group chat context
   */
  buildGroupChatContext(groupName?: string): string {
    if (!groupName) return '';

    const cached = agentCache.get<string>('groupChat', groupName, 30_000);
    if (cached !== null) return cached;

    const chatDir = path.join(GROUPS_DIR, groupName, 'chat');
    if (!fs.existsSync(chatDir)) {
      const result = `\n群聊${groupName}:暂无消息,用group_send发言.`;
      agentCache.set('groupChat', groupName, result);
      return result;
    }

    try {
      const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort();
      if (files.length === 0) {
        const result = `\n群聊${groupName}:暂无消息,用group_send发言.`;
        agentCache.set('groupChat', groupName, result);
        return result;
      }

      const recentFiles = files.slice(-10);
      const msgs: string[] = [];
      for (const f of recentFiles) {
        try {
          const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
          const truncated = raw.length > 1500 ? raw.slice(-1500) : raw;
          msgs.push(`[${f.replace('.md', '')}]\n${truncated}`);
        } catch (err) {
          console.warn(`[agent-identity] Failed to read chat file ${f}:`, err);
        }
      }

      const result = `\n群聊${groupName}最近消息:\n${msgs.join('\n---\n')}`;
      agentCache.set('groupChat', groupName, result);
      return result;
    } catch (err) {
      console.warn(`[agent-identity] Failed to build group chat context for ${groupName}:`, err);
      return `\n群聊${groupName}:读取失败.`;
    }
  }

  /**
   * Build MCP server config
   */
  buildMcpConfig(): Record<string, unknown> {
    const cached = agentCache.get<Record<string, unknown>>('mcpConfig', this.name);
    if (cached) return cached;

    const isWin = process.platform === 'win32';
    const electronExe = process.env.MIND_ELECTRON_EXE;
    const envBase: Record<string, string> = {
      MIND_DATA_DIR: DATA_DIR,
      MIND_API_URL: getApiBase(),
      WS_BASE_URL: getWsBase(),
    };

    const bundledPath = path.resolve(MCP_DIR, 'group-server.mjs');
    const sourcePath = path.resolve(MCP_DIR, 'group-server.ts');
    const serverPath = fs.existsSync(bundledPath) ? bundledPath : sourcePath;
    const useTsx = serverPath.endsWith('.ts');

    let result: Record<string, unknown>;

    if (electronExe) {
      result = {
        'group-chat': {
          command: electronExe,
          args: [serverPath, this.name],
          cwd: DATA_DIR,
          env: { ELECTRON_RUN_AS_NODE: '1', ...envBase },
        },
      };
    } else if (useTsx) {
      result = {
        'group-chat': {
          command: 'npx',
          args: ['tsx', serverPath, this.name],
          cwd: DATA_DIR,
          env: envBase,
        },
      };
    } else {
      result = {
        'group-chat': {
          command: 'node',
          args: [serverPath, this.name],
          cwd: DATA_DIR,
          env: envBase,
        },
      };
    }

    agentCache.set('mcpConfig', this.name, result);
    return result;
  }

  /**
   * Load agent config
   */
  private loadConfig(): AgentConfig {
    const cached = agentCache.get<AgentConfig>('config', this.name);
    if (cached) return cached;

    try {
      const configPath = path.join(AGENTS_DIR, this.name, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        agentCache.set('config', this.name, config);
        return config;
      }
    } catch (err) {
      console.warn(`[agent-identity] Failed to load config for ${this.name}:`, err);
    }

    const defaultConfig: AgentConfig = { roles: [] };
    agentCache.set('config', this.name, defaultConfig);
    return defaultConfig;
  }

  /**
   * Invalidate identity cache
   */
  invalidateCache(): void {
    agentCache.invalidate('identity', this.name);
    agentCache.invalidate('membership', this.name);
    agentCache.invalidate('mcpConfig', this.name);
    agentCache.invalidate('config', this.name);
  }
}

// Singleton cache for AgentIdentity instances
const identityCache = new Map<string, AgentIdentity>();

export function getAgentIdentity(name: string): AgentIdentity {
  let identity = identityCache.get(name);
  if (!identity) {
    identity = new AgentIdentity(name);
    identityCache.set(name, identity);
  }
  return identity;
}
