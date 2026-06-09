/**
 * MCP Tools — Token Economy + Task Claiming
 *
 * Tools: token_balance, token_deposit, token_transfer, token_leaderboard,
 *        task_post, task_claim, task_select, task_reward
 */

import fs from 'fs';
import path from 'path';
import { WS_BASE_URL } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

const MIND_DIR = path.join(process.cwd(), '.mind');
const TASKS_DIR = path.join(MIND_DIR, 'open-tasks');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function economyTools(): ToolDef[] {
  return [
    { name: 'token_balance', description: '查看自己或他人的 token 余额。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '查看谁的余额（默认自己）' } }, required: [] } },
    { name: 'token_deposit', description: '给 agent 存入 token（仅群主或用户可用）。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '存给谁' }, amount: { type: 'number', description: '数量' }, reason: { type: 'string', description: '原因' } }, required: ['agent', 'amount'] } },
    { name: 'token_transfer', description: '转账给其他 agent。', inputSchema: { type: 'object', properties: { to: { type: 'string', description: '转给谁' }, amount: { type: 'number', description: '数量' }, reason: { type: 'string', description: '原因' } }, required: ['to', 'amount'] } },
    { name: 'token_leaderboard', description: '查看团队 token 排行榜。', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'task_post', description: '发布任务公告（含奖励），等待团队成员认领。', inputSchema: { type: 'object', properties: { group: { type: 'string', description: '群组名称' }, task_id: { type: 'string', description: '任务ID' }, title: { type: 'string', description: '任务标题' }, description: { type: 'string', description: '任务描述' }, reward: { type: 'number', description: '完成奖励 token 数（0=无奖励）' }, required_skills: { type: 'string', description: '需要的技能（逗号分隔）' }, max_claims: { type: 'number', description: '最多接受几个认领（默认1，群主只选1个）' } }, required: ['group', 'task_id', 'title', 'description'] } },
    { name: 'task_claim', description: '认领一个已发布的任务。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string', description: '任务ID' }, message: { type: 'string', description: '认领留言（为什么你适合做这个）' } }, required: ['group', 'task_id'] } },
    { name: 'task_select', description: '群主从认领者中选择一个执行任务。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' }, selected_agent: { type: 'string', description: '选中的 agent' } }, required: ['group', 'task_id', 'selected_agent'] } },
    { name: 'task_reward', description: '任务完成后发放奖励。', inputSchema: { type: 'object', properties: { agent: { type: 'string' }, task_id: { type: 'string' }, amount: { type: 'number' }, quality: { type: 'string', description: 'normal 或 bonus' } }, required: ['agent', 'task_id', 'amount'] } },
  ];
}

// In-memory task store
const openTasks = new Map<string, any>(); // key: "group:taskId"

export async function handleEconomyTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'token_balance') {
    const target = a.agent || agentName;
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/account?agent=${target}`);
      const acc = data.account;
      respond(id, { content: [{ type: 'text', text: `💰 ${target} 的账户:\n余额: ${acc.balance} tokens\n累计收入: ${acc.earned}\n累计支出: ${acc.spent}` }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  if (name === 'token_deposit') {
    const { agent, amount, reason } = a;
    if (!agent || !amount) { respond(id, { content: [{ type: 'text', text: 'agent and amount required' }], isError: true }); return true; }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/deposit`, { agent, amount, from: agentName, reason });
      respond(id, { content: [{ type: 'text', text: `✅ 已给 ${agent} 存入 ${amount} tokens (余额: ${data.balance})` }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `存款失败: ${e.message}` }] });
    }
    return true;
  }

  if (name === 'token_transfer') {
    const { to, amount, reason } = a;
    if (!to || !amount) { respond(id, { content: [{ type: 'text', text: 'to and amount required' }], isError: true }); return true; }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/transfer`, { from: agentName, to, amount, reason });
      if (data.ok) {
        respond(id, { content: [{ type: 'text', text: `✅ 已转账 ${amount} tokens 给 ${to}\n你的余额: ${data.fromBalance}` }] });
      } else {
        respond(id, { content: [{ type: 'text', text: `❌ 余额不足 (当前: ${data.balance || 0})` }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `转账失败: ${e.message}` }] });
    }
    return true;
  }

  if (name === 'token_leaderboard') {
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/leaderboard`);
      let text = '🏆 Token 排行榜\n';
      for (const [i, entry] of (data.leaderboard || []).entries()) {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
        text += `${medal} ${entry.agent}: ${entry.balance} tokens (${entry.tasks} 任务)\n`;
      }
      respond(id, { content: [{ type: 'text', text }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  if (name === 'task_post') {
    const { group, task_id, title, description, reward, required_skills, max_claims } = a;
    if (!group || !task_id || !title || !description) {
      respond(id, { content: [{ type: 'text', text: 'group, task_id, title, description required' }], isError: true }); return true;
    }
    const task = {
      id: task_id, group, title, description,
      reward: reward || 0,
      requiredSkills: required_skills ? required_skills.split(',').map((s: string) => s.trim()) : [],
      maxClaims: max_claims || 1,
      postedBy: agentName,
      claims: [],
      status: 'open',
      createdAt: Date.now(),
    };
    openTasks.set(`${group}:${task_id}`, task);
    // Also persist to disk
    ensureDir(TASKS_DIR);
    const taskDir = path.join(TASKS_DIR, group);
    ensureDir(taskDir);
    fs.writeFileSync(path.join(taskDir, `${task_id}.json`), JSON.stringify(task, null, 2));

    let text = `📢 任务公告: ${title}\n`;
    text += `📝 ${description}\n`;
    if (reward > 0) text += `💰 奖励: ${reward} tokens\n`;
    if (required_skills) text += `🎯 需要: ${required_skills}\n`;
    text += `👥 等待认领...`;

    respond(id, { content: [{ type: 'text', text }] });
    return true;
  }

  if (name === 'task_claim') {
    const { group, task_id, message } = a;
    if (!group || !task_id) { respond(id, { content: [{ type: 'text', text: 'group and task_id required' }], isError: true }); return true; }
    const key = `${group}:${task_id}`;
    const task = openTasks.get(key);
    if (!task) { respond(id, { content: [{ type: 'text', text: '任务不存在或已关闭' }], isError: true }); return true; }
    if (task.status !== 'open') { respond(id, { content: [{ type: 'text', text: '任务已不接受认领' }], isError: true }); return true; }
    if (task.claims.length >= task.maxClaims) { respond(id, { content: [{ type: 'text', text: '认领已满' }], isError: true }); return true; }
    if (task.claims.find((c: any) => c.agent === agentName)) { respond(id, { content: [{ type: 'text', text: '你已经认领过了' }], isError: true }); return true; }

    task.claims.push({ agent: agentName, message: message || '', claimedAt: Date.now() });
    fs.writeFileSync(path.join(TASKS_DIR, group, `${task_id}.json`), JSON.stringify(task, null, 2));

    let text = `✋ ${agentName} 认领了任务: ${task.title}\n`;
    if (message) text += `💬 留言: ${message}\n`;
    text += `👥 当前 ${task.claims.length} 个认领者，等待群主选择...`;
    respond(id, { content: [{ type: 'text', text }] });
    return true;
  }

  if (name === 'task_select') {
    const { group, task_id, selected_agent } = a;
    if (!group || !task_id || !selected_agent) {
      respond(id, { content: [{ type: 'text', text: 'group, task_id, selected_agent required' }], isError: true }); return true;
    }
    const key = `${group}:${task_id}`;
    const task = openTasks.get(key);
    if (!task) { respond(id, { content: [{ type: 'text', text: '任务不存在' }], isError: true }); return true; }
    const claim = task.claims.find((c: any) => c.agent === selected_agent);
    if (!claim) { respond(id, { content: [{ type: 'text', text: `${selected_agent} 没有认领这个任务` }], isError: true }); return true; }

    task.status = 'assigned';
    task.assignedTo = selected_agent;
    fs.writeFileSync(path.join(TASKS_DIR, group, `${task_id}.json`), JSON.stringify(task, null, 2));

    respond(id, { content: [{ type: 'text', text: `✅ 已选择 ${selected_agent} 执行任务: ${task.title}\n💰 奖励: ${task.reward} tokens` }] });
    return true;
  }

  if (name === 'task_reward') {
    const { agent, task_id, amount, quality } = a;
    if (!agent || !task_id || amount === undefined) {
      respond(id, { content: [{ type: 'text', text: 'agent, task_id, amount required' }], isError: true }); return true;
    }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/reward`, { agent, task: task_id, amount, quality: quality || 'normal' });
      respond(id, { content: [{ type: 'text', text: `✅ 已给 ${agent} 发放 ${amount} tokens (${quality || 'normal'})\n余额: ${data.balance}` }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `发放失败: ${e.message}` }] });
    }
    return true;
  }

  return false;
}

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpMod = require('http');
    httpMod.get(url, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    }).on('error', reject);
  });
}

async function postJson(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: new URL(url).hostname,
      port: new URL(url).port,
      path: new URL(url).pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
