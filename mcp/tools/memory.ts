/**
 * MCP Server — Memory tools
 *
 * Tools: agent_memory
 */

import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function memoryTools(): ToolDef[] {
  return [
    { name: 'agent_memory', description: '管理长期记忆。读/写/搜索/列出记忆。', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'write | read | search | list | delete' }, key: { type: 'string' }, value: { type: 'string' }, query: { type: 'string' } }, required: ['action'] } },
  ];
}

const MEMORY_BASE = path.join(PROJECT_ROOT, '.mind', 'agents');

function memoryDir(agent: string): string { return path.join(MEMORY_BASE, agent, 'memory'); }

export async function handleMemoryTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'agent_memory') {
    const action = a.action || 'list';
    const mDir = memoryDir(agentName);

    if (action === 'write') {
      const key = (a.key || '').trim();
      const value = a.value || '';
      if (!key || !value) { respond(id, { content: [{ type: 'text', text: 'key and value required for write' }], isError: true }); return true; }
      if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
      const fp = path.join(mDir, `${safeKey}.md`);
      const now = new Date().toISOString();
      // Preserve created date if updating
      let created = now;
      if (fs.existsSync(fp)) {
        try {
          const old = fs.readFileSync(fp, 'utf-8');
          const m = old.match(/created:\s*(.+)/);
          if (m) created = m[1].trim();
        } catch {}
      }
      const content = `---\nkey: ${key}\ncreated: ${created}\nupdated: ${now}\n---\n\n${value}\n`;
      fs.writeFileSync(fp, content, 'utf-8');
      respond(id, { content: [{ type: 'text', text: `记忆已保存: ${key}` }] });
      return true;
    }

    if (action === 'read') {
      const key = (a.key || '').trim();
      if (!key) { respond(id, { content: [{ type: 'text', text: 'key required for read' }], isError: true }); return true; }
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
      const fp = path.join(mDir, `${safeKey}.md`);
      if (!fs.existsSync(fp)) { respond(id, { content: [{ type: 'text', text: `记忆 "${key}" 不存在` }] }); return true; }
      const raw = fs.readFileSync(fp, 'utf-8');
      const content = raw.replace(/^---[\s\S]*?---\n\n/, '').trim().slice(0, 2000);
      respond(id, { content: [{ type: 'text', text: content }] });
      return true;
    }

    if (action === 'search') {
      const query = (a.query || '').trim();
      if (!query) { respond(id, { content: [{ type: 'text', text: 'query required for search' }], isError: true }); return true; }
      if (!fs.existsSync(mDir)) { respond(id, { content: [{ type: 'text', text: '暂无记忆' }] }); return true; }

      // v0.4: Try semantic embedding search, fall back to substring
      try {
        const { embed, cosineSimilarity } = await import('../../src/lib/embedding.js');
        const files = fs.readdirSync(mDir).filter(f => f.endsWith('.md'));
        const entries: { key: string; content: string; updated: string; raw: string }[] = [];
        for (const f of files) {
          try {
            const raw = fs.readFileSync(path.join(mDir, f), 'utf-8');
            const keyMatch = raw.match(/key:\s*(.+)/);
            const updatedMatch = raw.match(/updated:\s*(.+)/);
            const content = raw.replace(/^---[\s\S]*?---\n\n/, '').trim();
            entries.push({
              key: keyMatch?.[1]?.trim() || f.replace('.md', ''),
              content,
              updated: updatedMatch?.[1]?.trim() || '',
              raw,
            });
          } catch {}
        }
        if (entries.length === 0) { respond(id, { content: [{ type: 'text', text: '暂无记忆' }] }); return true; }

        const queryVec = await embed(query);
        const texts = entries.map(e => `${e.key} ${e.content}`);
        const entryVecs = await Promise.all(texts.map(t => embed(t)));
        const scored = entries.map((e, i) => ({ ...e, score: cosineSimilarity(queryVec, entryVecs[i]) }));
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 10);
        respond(id, { content: [{ type: 'text', text: top.length > 0 ? top.map(r => `[${r.key}] ${r.content.slice(0, 200)}`).join('\n\n') : '未找到匹配的记忆' }] });
      } catch {
        // Fallback to substring
        const queryLower = query.toLowerCase();
        const files = fs.readdirSync(mDir).filter(f => f.endsWith('.md'));
        const results: { key: string; snippet: string; updated: string }[] = [];
        for (const f of files) {
          try {
            const raw = fs.readFileSync(path.join(mDir, f), 'utf-8');
            if (!raw.toLowerCase().includes(queryLower)) continue;
            const keyMatch = raw.match(/key:\s*(.+)/);
            const updatedMatch = raw.match(/updated:\s*(.+)/);
            const content = raw.replace(/^---[\s\S]*?---\n\n/, '').trim();
            results.push({ key: keyMatch?.[1]?.trim() || f.replace('.md', ''), snippet: content.slice(0, 200), updated: updatedMatch?.[1]?.trim() || '' });
          } catch {}
        }
        results.sort((a, b) => b.updated.localeCompare(a.updated));
        respond(id, { content: [{ type: 'text', text: results.length > 0 ? results.slice(0, 10).map(r => `[${r.key}] ${r.snippet}`).join('\n\n') : '未找到匹配的记忆' }] });
      }
      return true;
    }

    if (action === 'list') {
      if (!fs.existsSync(mDir)) { respond(id, { content: [{ type: 'text', text: '暂无记忆' }] }); return true; }
      const files = fs.readdirSync(mDir).filter(f => f.endsWith('.md'));
      const entries: { key: string; updated: string }[] = [];
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(mDir, f), 'utf-8');
          const keyMatch = raw.match(/key:\s*(.+)/);
          const updatedMatch = raw.match(/updated:\s*(.+)/);
          entries.push({ key: keyMatch?.[1]?.trim() || f.replace('.md', ''), updated: updatedMatch?.[1]?.trim() || '' });
        } catch { /* skip */ }
      }
      entries.sort((a, b) => b.updated.localeCompare(a.updated));
      respond(id, { content: [{ type: 'text', text: entries.length > 0 ? entries.map(e => `• ${e.key} (${e.updated})`).join('\n') : '暂无记忆' }] });
      return true;
    }

    if (action === 'delete') {
      const key = (a.key || '').trim();
      if (!key) { respond(id, { content: [{ type: 'text', text: 'key required for delete' }], isError: true }); return true; }
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
      const fp = path.join(mDir, `${safeKey}.md`);
      if (!fs.existsSync(fp)) { respond(id, { content: [{ type: 'text', text: `记忆 "${key}" 不存在` }] }); return true; }
      fs.unlinkSync(fp);
      respond(id, { content: [{ type: 'text', text: `记忆已删除: ${key}` }] });
      return true;
    }

    respond(id, { content: [{ type: 'text', text: `未知 action: ${action}. 使用 write/read/search/list/delete` }], isError: true });
    return true;
  }

  return false;
}
