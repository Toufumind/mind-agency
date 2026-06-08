import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getStats } from '@/lib/agents';
import fs from 'fs';
import path from 'path';
import { writeAudit } from '@/lib/audit';
import { AGENTS_DIR } from '@/lib/data-dir';
import { broadcastWs } from '@/lib/ws-embedded';

export async function GET() {
  try {
    const agents = getAgents();
    const stats = getStats();
    const agentList = agents.map(a => ({ name: a.name, emailCount: a.emailCount, config: a.config }));
    return NextResponse.json({ agents: agentList, stats });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) return NextResponse.json({ error: 'Agent name required' }, { status: 400 });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    const agentDir = path.join(AGENTS_DIR, name);
    if (!fs.existsSync(agentDir)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    writeAudit({ agent: name, action: 'agent.delete', resource: `agent:${name}`, details: 'Agent directory removed' });
    fs.rmSync(agentDir, { recursive: true, force: true });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}

// Create new agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
    }

    const agentDir = path.join(AGENTS_DIR, name);
    if (fs.existsSync(agentDir)) {
      return NextResponse.json({ error: 'Agent already exists' }, { status: 409 });
    }

    // Create directory structure
    fs.mkdirSync(path.join(agentDir, 'email'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'chat'), { recursive: true });

    // CLAUDE.md
    const claudeMd = `# 规则\n\n## 你的邮箱\nemail/ 文件夹是你的个人邮箱（收件箱）。\n你不能在自己的 email/ 文件夹下添加或修改任何文件。\n你可以查看和删除自己邮箱里的邮件。\n\n## 给其他人发邮件\n在对方的 email/ 文件夹下创建一个 .md 文件。\n邮件格式：YAML frontmatter (from/to/subject/date) + Markdown 正文。\n文件名建议：YYYY-MM-DD_主题简述.md\n\n## 寻找团队成员\n查看 Agents/ 目录了解团队中有哪些成员。\n`;
    fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), claudeMd, 'utf-8');

    // .claude/CLAUDE.md
    fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.claude', 'CLAUDE.md'), `你的名字是 ${name}。你是 Mind Agency 团队的一员。`, 'utf-8');

    // config.json
    const config = {
      autoRespondToEmail: body.autoRespondToEmail ?? false,
      autoProcessGroupInvites: body.autoProcessGroupInvites ?? false,
      roles: body.roles || ['member'],
      permissions: body.permissions || { canCreateGroup: false, canDeleteGroup: false, canDeploy: false },
      ...(body.allowedTools ? { allowedTools: body.allowedTools } : {}),
      ...(body.disallowedTools ? { disallowedTools: body.disallowedTools } : {}),
      ...(body.permissionMode ? { permissionMode: body.permissionMode } : {}),
      ...(body.maxTurns ? { maxTurns: body.maxTurns } : {}),
    };
    fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

    writeAudit({ agent: name, action: 'agent.create', resource: `agent:${name}`, details: `roles: ${config.roles.join(',')}` });

    broadcastWs('sidebar_refresh', {});
    return NextResponse.json({ success: true, name, config });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
