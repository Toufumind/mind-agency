/**
 * MCP Server — Group management tools
 *
 * Tools: group_list, group_create, group_delete, group_join, group_leave,
 *        group_invite, group_kick, group_set_admin, group_set_role,
 *        group_get_info, group_set_info, group_announce
 */

import fs from 'fs';
import path from 'path';
import { groupsDir, exists, readDir, appendToChat, triggerPoll, emitBusEvent, writeAudit, broadcast } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function groupTools(): ToolDef[] {
  return [
    { name: 'group_list', description: '列出你所在的所有群组。', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'group_create', description: '创建一个新的群组。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'group_delete', description: '删除群组（需要 canDeleteGroup 权限）。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'group_join', description: '加入群组。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'group_leave', description: '退出群组。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'group_invite', description: '邀请 Agent 加入群组（需要管理员权限）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, agent: { type: 'string' } }, required: ['group', 'agent'] } },
    { name: 'group_kick', description: '将成员踢出群组（需要管理员权限）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, agent: { type: 'string' } }, required: ['group', 'agent'] } },
    { name: 'group_set_admin', description: '设置或取消群管理员（仅群主）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, agent: { type: 'string' }, admin: { type: 'boolean' } }, required: ['group', 'agent', 'admin'] } },
    { name: 'group_set_role', description: '设置成员角色（owner/admin/member）。仅群主。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, agent: { type: 'string' }, role: { type: 'string' } }, required: ['group', 'agent', 'role'] } },
    { name: 'group_get_info', description: '获取群信息。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'group_set_info', description: '修改群名称和简介（需要管理员权限）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['group'] } },
    { name: 'group_announce', description: '发布/更新/移除群公告（需要管理员权限）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, clear: { type: 'boolean' } }, required: ['group'] } },
  ];
}

export async function handleGroupTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'group_list') {
    const gd = groupsDir();
    if (!exists(gd)) { respond(id, { content: [{ type: 'text', text: '暂无群组' }] }); return true; }
    const groupDirs = readDir(gd).filter(e => e.isDirectory() && !e.name.startsWith('.'));
    const myGroups: string[] = [];
    for (const g of groupDirs) {
      const agDir = path.join(gd, g.name, 'Agents');
      if (exists(agDir) && readDir(agDir).some(d => d.isDirectory() && d.name.toLowerCase() === agentName.toLowerCase())) {
        myGroups.push(g.name);
      }
    }
    if (myGroups.length === 0) { respond(id, { content: [{ type: 'text', text: '你还没有加入任何群组' }] }); return true; }
    let text = `你所在的所有群组 (${myGroups.length}):\n`;
    for (const g of myGroups) {
      const agDir = path.join(gd, g, 'Agents');
      const members = exists(agDir) ? readDir(agDir).filter(e => e.isDirectory()).map(e => e.name) : [];
      text += `\n• ${g} (${members.length} 成员)\n  成员: ${members.join(', ')}`;
    }
    respond(id, { content: [{ type: 'text', text }] }); return true;
  }

  if (name === 'group_create') {
    const group = (a.group || '').trim();
    if (!group || !/^[a-zA-Z0-9_-]+$/.test(group)) { respond(id, { content: [{ type: 'text', text: 'Invalid group name' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    if (exists(gDir)) { respond(id, { content: [{ type: 'text', text: `Group "${group}" already exists` }], isError: true }); return true; }
    fs.mkdirSync(path.join(gDir, 'Agents', agentName, 'email'), { recursive: true });
    fs.mkdirSync(path.join(gDir, 'chat'), { recursive: true });
    fs.writeFileSync(path.join(gDir, 'TASK_SPEC.md'), `# ${group}\n\n> Created by ${agentName}\n`, 'utf-8');
    // Initialize config
    const config = { owner: agentName, admins: [], createdAt: Date.now(), name: group };
    fs.writeFileSync(path.join(gDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    appendToChat(group, 'system', `${agentName} 创建了群组 "${group}"`);
    triggerPoll(agentName, group);
    writeAudit({ agent: agentName, action: 'group.create', resource: `group:${group}` });
    respond(id, { content: [{ type: 'text', text: `group "${group}" created. You are now a member.` }] });
    return true;
  }

  if (name === 'group_delete') {
    const group = a.group;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    if (!exists(gDir)) { respond(id, { content: [{ type: 'text', text: `Group "${group}" not found` }], isError: true }); return true; }
    fs.rmSync(gDir, { recursive: true, force: true });
    emitBusEvent('task.completed', { taskId: `group:${group}`, by: agentName, action: 'group_delete' });
    respond(id, { content: [{ type: 'text', text: `group "${group}" deleted` }] });
    return true;
  }

  if (name === 'group_join') {
    const group = a.group;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    if (!exists(gDir)) { respond(id, { content: [{ type: 'text', text: `Group "${group}" not found` }], isError: true }); return true; }
    const agDir = path.join(gDir, 'Agents', agentName);
    if (exists(agDir)) { respond(id, { content: [{ type: 'text', text: `Already a member of ${group}` }] }); return true; }
    // Check for invitation
    const invFile = path.join(gDir, '.invitations', `${agentName}.json`);
    let wasInvited = false;
    if (exists(invFile)) {
      wasInvited = true;
      fs.unlinkSync(invFile);
    } else {
      // Check if group has members — if so, need invitation
      const membersDir = path.join(gDir, 'Agents');
      if (exists(membersDir) && readDir(membersDir).filter(e => e.isDirectory()).length > 0) {
        respond(id, { content: [{ type: 'text', text: `${group} 需要邀请才能加入。请让群组的管理员邀请你。` }] });
        return true;
      }
    }
    fs.mkdirSync(path.join(agDir, 'email'), { recursive: true });
    appendToChat(group, 'system', `${agentName} ${wasInvited ? '接受了邀请并' : ''}加入了群组`);
    writeAudit({ agent: agentName, action: 'group.join', resource: `group:${group}`, details: wasInvited ? 'accepted invitation' : 'joined directly' });
    triggerPoll(agentName, group);
    respond(id, { content: [{ type: 'text', text: `joined ${group}${wasInvited ? ' (accepted invitation)' : ''}` }] });
    return true;
  }

  if (name === 'group_leave') {
    const group = a.group;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const agDir = path.join(groupsDir(), group, 'Agents', agentName);
    if (!exists(agDir)) { respond(id, { content: [{ type: 'text', text: `Not a member of ${group}` }], isError: true }); return true; }
    fs.rmSync(agDir, { recursive: true, force: true });
    writeAudit({ agent: agentName, action: 'group.leave', resource: `group:${group}` });
    triggerPoll(agentName, group);
    respond(id, { content: [{ type: 'text', text: `left ${group}` }] });
    return true;
  }

  if (name === 'group_invite') {
    const { group, agent: target } = a;
    if (!group || !target) { respond(id, { content: [{ type: 'text', text: 'group and agent required' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    const invDir = path.join(gDir, '.invitations');
    if (!exists(invDir)) fs.mkdirSync(invDir, { recursive: true });
    const invFile = path.join(invDir, `${target}.json`);
    fs.writeFileSync(invFile, JSON.stringify({ invitedBy: agentName, invitedAt: Date.now() }), 'utf-8');
    appendToChat(group, 'system', `${agentName} 邀请了 ${target} 加入群组（等待 ${target} 接受）`);
    writeAudit({ agent: agentName, action: 'group.invite', resource: `group:${group}`, details: `invited ${target}` });
    triggerPoll(target, group);
    respond(id, { content: [{ type: 'text', text: `sent invitation to ${target} for ${group}` }] });
    return true;
  }

  if (name === 'group_kick') {
    const { group, agent: target } = a;
    if (!group || !target) { respond(id, { content: [{ type: 'text', text: 'group and agent required' }], isError: true }); return true; }
    const targetDir = path.join(groupsDir(), group, 'Agents', target);
    if (exists(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      appendToChat(group, 'system', `${target} 被 ${agentName} 踢出了群组`);
      writeAudit({ agent: agentName, action: 'group.kick', resource: `group:${group}`, details: `kicked ${target}` });
      triggerPoll(agentName, group);
      respond(id, { content: [{ type: 'text', text: `kicked ${target} from ${group}` }] });
    } else {
      respond(id, { content: [{ type: 'text', text: `${target} is not a member of ${group}` }], isError: true });
    }
    return true;
  }

  if (name === 'group_set_admin') {
    const { group, agent: target, admin } = a;
    if (!group || !target || admin === undefined) { respond(id, { content: [{ type: 'text', text: 'group, agent, admin required' }], isError: true }); return true; }
    const configPath = path.join(groupsDir(), group, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: 'Group config not found' }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (admin && !config.admins.includes(target)) config.admins.push(target);
    if (!admin) config.admins = config.admins.filter((a: string) => a !== target);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `${target} ${admin ? 'is now' : 'is no longer'} admin of ${group}` }] });
    return true;
  }

  if (name === 'group_set_role') {
    const { group, agent: target, role } = a;
    if (!group || !target || !role) { respond(id, { content: [{ type: 'text', text: 'group, agent, role required' }], isError: true }); return true; }
    if (!['owner', 'admin', 'member'].includes(role)) { respond(id, { content: [{ type: 'text', text: 'role must be owner, admin, or member' }], isError: true }); return true; }
    const configPath = path.join(groupsDir(), group, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: 'Group config not found' }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.memberRoles) config.memberRoles = {};
    config.memberRoles[target] = role;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `${target} role set to ${role} in ${group}` }] });
    return true;
  }

  if (name === 'group_get_info') {
    const group = a.group;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const configPath = path.join(groupsDir(), group, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: 'Group not found' }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const agDir = path.join(groupsDir(), group, 'Agents');
    const members = exists(agDir) ? readDir(agDir).filter(e => e.isDirectory()).map(e => e.name) : [];
    respond(id, { content: [{ type: 'text', text: JSON.stringify({ name: config.name || group, description: config.description, announcement: config.announcement, owner: config.owner, admins: config.admins, members }, null, 2) }] });
    return true;
  }

  if (name === 'group_set_info') {
    const { group, name: newName, description } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const configPath = path.join(groupsDir(), group, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: 'Group not found' }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (newName !== undefined) config.name = newName;
    if (description !== undefined) config.description = description;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `group info updated for ${group}` }] });
    return true;
  }

  if (name === 'group_announce') {
    const { group, title, content: annContent, clear } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const configPath = path.join(groupsDir(), group, 'config.json');
    if (!exists(configPath)) { respond(id, { content: [{ type: 'text', text: 'Group not found' }], isError: true }); return true; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (clear) {
      delete config.announcement;
    } else {
      config.announcement = { title: title || '', content: annContent || '', pinnedBy: agentName, pinnedAt: Date.now() };
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: clear ? `announcement removed from ${group}` : `announcement published to ${group}` }] });
    return true;
  }

  return false;
}
