/**
 * EmailProxy — unified email management in Next.js process.
 *
 * Consolidates ALL email logic:
 *   - Personal email:  Agents/<name>/email/
 *   - Group email:     Groups/<name>/Agents/<name>/email/
 *   - Send (write .md with YAML frontmatter)
 *   - List / delete
 *
 * Singleton instance — use getEmailProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR } from './data-dir';

// ── Types ─────────────────────────────────────────────────

export interface Email {
  from: string;
  to: string;
  subject: string;
  body: string;
  filename: string;
  timestamp: number;
}

// ── EmailProxy class ──────────────────────────────────────

export class EmailProxy {
  private _emailCache: Map<string, Email[]> = new Map();
  private _loaded: Map<string, boolean> = new Map();

  constructor() {}

  // ── Read Emails ──────────────────────────────────────

  /**
   * Get all emails for an agent (personal inbox).
   */
  async getEmails(agentName: string): Promise<Email[]> {
    if (this._loaded.get(agentName)) {
      return this._emailCache.get(agentName) || [];
    }

    const emails: Email[] = [];
    try {
      const emailDir = path.join(AGENTS_DIR, agentName, 'email');
      if (!fs.existsSync(emailDir)) {
        this._emailCache.set(agentName, emails);
        this._loaded.set(agentName, true);
        return emails;
      }

      const files = fs.readdirSync(emailDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(emailDir, file), 'utf-8');
          const email = this.parseEmailFile(content, file);
          if (email) emails.push(email);
        } catch {}
      }
    } catch {}

    this._emailCache.set(agentName, emails);
    this._loaded.set(agentName, true);
    return emails;
  }

  /**
   * Parse an email .md file with YAML frontmatter.
   */
  private parseEmailFile(content: string, filename: string): Email | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2].trim();

    const from = frontmatter.match(/from:\s*(.+)/)?.[1]?.trim() || '';
    const to = frontmatter.match(/to:\s*(.+)/)?.[1]?.trim() || '';
    const subject = frontmatter.match(/subject:\s*(.+)/)?.[1]?.trim() || '';
    const dateStr = frontmatter.match(/date:\s*(.+)/)?.[1]?.trim();
    const timestamp = dateStr ? new Date(dateStr).getTime() : 0;

    return { from, to, subject, body, filename, timestamp };
  }

  // ── Send Emails ──────────────────────────────────────

  /**
   * Send an email from one agent to another.
   */
  async sendEmail(from: string, to: string, subject: string, body: string): Promise<boolean> {
    try {
      const emailDir = path.join(AGENTS_DIR, to, 'email');
      if (!fs.existsSync(emailDir)) fs.mkdirSync(emailDir, { recursive: true });

      const safeFrom = from.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const safeSubject = subject.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
      const timestamp = Date.now();
      const filename = `${timestamp}_${safeFrom}_${safeSubject}.md`;

      const content = `---\nfrom: ${from}\nto: ${to}\nsubject: ${subject}\ndate: ${new Date().toISOString()}\n---\n\n${body}\n`;

      const filePath = path.join(emailDir, filename);
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, filePath);

      // Invalidate cache for recipient
      this._emailCache.delete(to);
      this._loaded.delete(to);

      return true;
    } catch (err) {
      console.error(`[email-proxy] sendEmail(${from} -> ${to}):`, err);
      return false;
    }
  }

  // ── Delete Emails ────────────────────────────────────

  /**
   * Delete an email from an agent's inbox.
   */
  async deleteEmail(agentName: string, filename: string): Promise<boolean> {
    try {
      const emailPath = path.join(AGENTS_DIR, agentName, 'email', filename);
      if (!fs.existsSync(emailPath)) return false;

      fs.unlinkSync(emailPath);

      // Invalidate cache
      this._emailCache.delete(agentName);
      this._loaded.delete(agentName);

      return true;
    } catch (err) {
      console.error(`[email-proxy] deleteEmail(${agentName}, ${filename}):`, err);
      return false;
    }
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Invalidate email cache for an agent.
   */
  invalidateCache(agentName?: string): void {
    if (agentName) {
      this._emailCache.delete(agentName);
      this._loaded.delete(agentName);
    } else {
      this._emailCache.clear();
      this._loaded.clear();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this._emailCache.clear();
    this._loaded.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: EmailProxy | null = null;

export function getEmailProxy(): EmailProxy {
  if (!instance) {
    instance = new EmailProxy();
  }
  return instance;
}
