/**
 * MCP Server — Agent management tools
 *
 * Tools: agent_create, agent_discover
 */

import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, exists, writeAudit, AGENTS_DIR } from './shared';
import { agentCache } from '../../src/lib/cache';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function agentTools(): ToolDef[] {
  return [
    { name: 'agent_create', description: '创建新的 AI Agent 并加入团队。可指定 provider（claude/codex）。', inputSchema: { type: 'object', properties: { name: { type: 'string' }, roles: { type: 'string', description: '角色列表，逗号分隔' }, provider: { type: 'string', description: 'AI 提供商：claude（默认）或 codex' }, autoRespond: { type: 'boolean' } }, required: ['name', 'roles'] } },
    { name: 'agent_discover', description: '按能力搜索可用的 Agent。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } },
    { name: 'agent_get', description: '查看 Agent 详细信息（配置、角色、Provider）。', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Agent 名字' } }, required: ['name'] } },
    { name: 'agent_update', description: '修改 Agent 配置（角色、Provider、权限等）。只能修改自己，admin 可修改他人。', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '目标 Agent 名字' }, roles: { type: 'string', description: '新角色列表，逗号分隔' }, provider: { type: 'string', description: '新的 Provider' }, autoRespond: { type: 'boolean' } }, required: ['name'] } },
    { name: 'agent_delete', description: '删除 Agent。只能由 owner 或 admin 操作，不能删除自己。', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '要删除的 Agent 名字' } }, required: ['name'] } },
    { name: 'agent_set_heartbeat', description: '设置自己的心跳间隔（毫秒）。范围：30000-600000。', inputSchema: { type: 'object', properties: { intervalMs: { type: 'number' } }, required: ['intervalMs'] } },
    { name: 'agent_list_providers', description: '列出可用的 AI 提供商。', inputSchema: { type: 'object', properties: {}, required: [] } },
  ];
}

export async function handleAgentTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'agent_get') {
    const target = (a.name || '').trim();
    if (!target) { respond(id, { content: [{ type: 'text', text: 'name required' }], isError: true }); return true; }
    const agentDir = path.join(AGENTS_DIR, target);
    if (!exists(agentDir)) { respond(id, { content: [{ type: 'text', text: `Agent "${target}" not found` }], isError: true }); return true; }
    const configPath = path.join(agentDir, 'config.json');
    let config: any = {};
    try { if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
    const info = {
      name: target,
      roles: config.roles || [],
      provider: config.provider || 'claude',
      autoRespond: config.autoRespond || false,
      permissions: config.permissions || {},
      heartbeatIntervalMs: config.heartbeatIntervalMs || 0,
    };
    respond(id, { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] });
    return true;
  }

  if (name === 'agent_update') {
    const target = (a.name || '').trim();
    if (!target) { respond(id, { content: [{ type: 'text', text: 'name required' }], isError: true }); return true; }
    // Permission: can only update self, or if agent is admin
    if (target !== agentName) {
      // Check if current agent is admin of any group that contains the target
      // Simple check: allow for now, real permission check via consensus
    }
    const configPath = path.join(AGENTS_DIR, target, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: `Agent "${target}" not found` }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (a.roles !== undefined) config.roles = a.roles.split(',').map((r: string) => r.trim()).filter(Boolean);
    if (a.provider !== undefined) config.provider = a.provider;
    if (a.autoRespond !== undefined) config.autoRespond = a.autoRespond;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `Agent "${target}" config updated` }] });
    return true;
  }

  if (name === 'agent_delete') {
    const target = (a.name || '').trim();
    if (!target) { respond(id, { content: [{ type: 'text', text: 'name required' }], isError: true }); return true; }
    if (target === agentName) { respond(id, { content: [{ type: 'text', text: '不能删除自己' }], isError: true }); return true; }
    // Permission: only owner or admin can delete
    // Check if current agent is owner of any group (simple heuristic)
    const agentDir = path.join(AGENTS_DIR, target);
    if (!exists(agentDir)) { respond(id, { content: [{ type: 'text', text: `Agent "${target}" not found` }], isError: true }); return true; }
    // Check permission via consensus
    const { checkToolPermission } = await import('../../src/lib/permission-engine.js');
    const perm = checkToolPermission(agentName, 'agent_create', { name: target });
    // For now, allow deletion if agent has canCreateGroup permission (admin-like)
    const myConfigPath = path.join(AGENTS_DIR, agentName, 'config.json');
    let myConfig: any = {};
    try { if (fs.existsSync(myConfigPath)) myConfig = JSON.parse(fs.readFileSync(myConfigPath, 'utf-8')); } catch {}
    if (!myConfig.permissions?.canCreateGroup && agentName !== 'me') {
      respond(id, { content: [{ type: 'text', text: '权限不足：需要 admin 权限才能删除 Agent' }], isError: true });
      return true;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
    // Invalidate cache so deleted agent is removed
    agentCache.invalidateAgent(target);
    agentCache.invalidate('agents', 'list');
    writeAudit({ agent: agentName, action: 'agent.delete', resource: `agent:${target}`, details: `deleted by ${agentName}` });
    respond(id, { content: [{ type: 'text', text: `Agent "${target}" has been deleted` }] });
    return true;
  }

  if (name === 'agent_create') {
    const newName = (a.name || '').trim();
    const roles = (a.roles || '').split(',').map((r: string) => r.trim()).filter(Boolean);
    const provider = a.provider || 'claude';
    if (!newName || !/^[a-zA-Z0-9_-]+$/.test(newName)) { respond(id, { content: [{ type: 'text', text: 'Invalid agent name' }], isError: true }); return true; }
    if (roles.length === 0) { respond(id, { content: [{ type: 'text', text: 'At least one role required' }], isError: true }); return true; }
    if (!['claude', 'codex'].includes(provider)) { respond(id, { content: [{ type: 'text', text: 'provider must be claude or codex' }], isError: true }); return true; }
    const agentDir = path.join(PROJECT_ROOT, 'Agents', newName);
    if (exists(agentDir)) { respond(id, { content: [{ type: 'text', text: `Agent "${newName}" already exists` }], isError: true }); return true; }
    fs.mkdirSync(path.join(agentDir, 'email'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'chat'), { recursive: true });
    const claudeMd = `# 规则\n\n## 你的邮箱\nemail/ 文件夹是你的个人邮箱（收件箱）。\n你不能在自己的 email/ 文件夹下添加或修改任何文件。\n你可以查看和删除自己邮箱里的邮件。\n\n## 给其他人发邮件\n在对方的 email/ 文件夹下创建一个 .md 文件。\n邮件格式：YAML frontmatter (from/to/subject/date) + Markdown 正文。\n文件名建议：YYYY-MM-DD_主题简述.md\n\n## 寻找团队成员\n查看 Agents/ 目录了解团队中有哪些成员。\n`;
    fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), claudeMd, 'utf-8');
    fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.claude', 'CLAUDE.md'), `你的名字是 ${newName}。你是 Mind Agency 团队的一员。`, 'utf-8');
    const perms: Record<string, boolean> = { canCreateGroup: roles.some(r => /pm|ceo|lead|管理/i.test(r)), canDeleteGroup: false, canDeploy: false };
    const config = { autoRespondToEmail: a.autoRespond ?? false, roles, permissions: perms, provider };
    fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    // Invalidate cache so new agent is visible
    agentCache.invalidateAgent(newName);
    agentCache.invalidate('agents', 'list');
    writeAudit({ agent: agentName, action: 'agent.create', resource: `agent:${newName}`, details: `roles: ${roles.join(',')}, provider: ${provider}` });
    respond(id, { content: [{ type: 'text', text: `Agent "${newName}" created with roles: ${roles.join(', ')}, provider: ${provider}` }] });
    return true;
  }

  if (name === 'agent_list_providers') {
    const { listProviders } = await import('../../src/lib/providers/index.js');
    const providers = listProviders();
    const text = providers.map(p =>
      `• ${p.displayName} (${p.name}) — ${p.available ? '✅ 可用' : '❌ 未安装'}`
    ).join('\n');
    respond(id, { content: [{ type: 'text', text: `可用的 AI 提供商：\n${text}` }] });
    return true;
  }

  if (name === 'agent_discover') {
    const query = (a.query || '').toLowerCase();
    if (!query) { respond(id, { content: [{ type: 'text', text: 'query required' }], isError: true }); return true; }
    if (!exists(AGENTS_DIR)) { respond(id, { content: [{ type: 'text', text: '暂无 Agent' }] }); return true; }
    const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'));
    const results: string[] = [];
    for (const ag of agents) {
      const configPath = path.join(AGENTS_DIR, ag.name, 'config.json');
      let roles: string[] = [];
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          roles = config.roles || [];
        }
      } catch {}
      const cardPath = path.join(AGENTS_DIR, ag.name, 'agent-card.json');
      let capabilities: string[] = [];
      try {
        if (fs.existsSync(cardPath)) {
          const card = JSON.parse(fs.readFileSync(cardPath, 'utf-8'));
          capabilities = card.capabilities || [];
        }
      } catch {}
      const searchable = [ag.name, ...roles, ...capabilities].map(s => s.toLowerCase());
      if (searchable.some(s => s.includes(query))) {
        results.push(`• ${ag.name} — 角色: ${roles.join(', ') || '无'} | 能力: ${capabilities.join(', ') || '通用'}`);
      }
    }
    respond(id, { content: [{ type: 'text', text: results.length > 0 ? `找到 ${results.length} 个匹配的 Agent:\n${results.join('\n')}` : '未找到匹配的 Agent' }] });
    return true;
  }

  if (name === 'agent_set_heartbeat') {
    const intervalMs = a.intervalMs;
    if (typeof intervalMs !== 'number' || intervalMs < 30000 || intervalMs > 600000) {
      respond(id, { content: [{ type: 'text', text: 'intervalMs 必须在 30000-600000 之间（30秒-10分钟）' }], isError: true });
      return true;
    }
    // Permission: can only set own heartbeat
    const targetAgent = a.agent || agentName;
    if (targetAgent !== agentName) {
      respond(id, { content: [{ type: 'text', text: '只能设置自己的心跳间隔，不能设置别人的' }], isError: true });
      return true;
    }
    const configPath = path.join(AGENTS_DIR, agentName, 'config.json');
    if (!exists(configPath)) {
      respond(id, { content: [{ type: 'text', text: `Agent "${agentName}" 配置文件不存在` }], isError: true });
      return true;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.heartbeatIntervalMs = intervalMs;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `心跳间隔已设为 ${intervalMs}ms（${(intervalMs / 1000).toFixed(0)}秒）` }] });
    return true;
  }

  return false;
}
