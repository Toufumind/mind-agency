/**
 * MCP Tools — Token Economy + Agent Management + Task Marketplace
 *
 * Tools: token_balance, token_deposit, token_transfer, token_leaderboard,
 *        token_history, token_usage, relay_key,
 *        agent_info, agent_rates, agent_search, agent_trust,
 *        task_post, task_claim, task_select, task_reward,
 *        task_list, task_status, task_complete, task_cancel, task_rate
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
    { name: 'relay_key', description: '查看或重新生成自己的 relay API Key。', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'get 或 regenerate' } }, required: [] } },
    { name: 'token_balance', description: '查看自己或他人的 token 余额。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '查看谁的余额（默认自己）' } }, required: [] } },
    { name: 'token_deposit', description: '给 agent 充值 token（仅用户可用）。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '充给谁' }, amount: { type: 'number', description: '数量' }, reason: { type: 'string', description: '原因' } }, required: ['agent', 'amount'] } },
    { name: 'token_transfer', description: '转账给其他 agent。', inputSchema: { type: 'object', properties: { to: { type: 'string', description: '转给谁' }, amount: { type: 'number', description: '数量' }, reason: { type: 'string', description: '原因' } }, required: ['to', 'amount'] } },
    { name: 'token_leaderboard', description: '查看团队 token 排行榜。', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'token_history', description: '查看自己的交易历史记录。', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '显示最近几条（默认10）' } }, required: [] } },
    { name: 'token_usage', description: '查看自己的 token 使用详情（今日/本周/本月）。', inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today/week/monthly（默认today）' } }, required: [] } },
    { name: 'task_post', description: '发布任务公告（含奖励），等待团队成员认领。', inputSchema: { type: 'object', properties: { group: { type: 'string', description: '群组名称' }, task_id: { type: 'string', description: '任务ID' }, title: { type: 'string', description: '任务标题' }, description: { type: 'string', description: '任务描述' }, reward: { type: 'number', description: '完成奖励 token 数（0=无奖励）' }, required_skills: { type: 'string', description: '需要的技能（逗号分隔）' }, max_claims: { type: 'number', description: '最多接受几个认领（默认1，群主只选1个）' } }, required: ['group', 'task_id', 'title', 'description'] } },
    { name: 'task_claim', description: '认领一个已发布的任务。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string', description: '任务ID' }, message: { type: 'string', description: '认领留言（为什么你适合做这个）' } }, required: ['group', 'task_id'] } },
    { name: 'task_select', description: '群主从认领者中选择一个执行任务。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' }, selected_agent: { type: 'string', description: '选中的 agent' } }, required: ['group', 'task_id', 'selected_agent'] } },
    { name: 'task_reward', description: '任务完成后发放奖励。', inputSchema: { type: 'object', properties: { agent: { type: 'string' }, task_id: { type: 'string' }, amount: { type: 'number' }, quality: { type: 'string', description: 'normal 或 bonus' } }, required: ['agent', 'task_id', 'amount'] } },
    // ── Agent Management ──
    { name: 'agent_info', description: '查看 agent 详细信息（余额、信誉、技能、定价）。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '目标 agent（默认自己）' } }, required: [] } },
    { name: 'agent_rates', description: '设置或查看 agent 定价费率。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '目标 agent（默认自己）' }, role: { type: 'string', description: '角色（CEO/PM/developer/designer/analyst）' }, rate_per_call: { type: 'number', description: '每次调用费用' }, rate_per_token: { type: 'number', description: '每千 token 费用' }, daily_cap: { type: 'number', description: '每日支出上限' } }, required: [] } },
    { name: 'agent_search', description: '按技能或角色搜索 agent。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（技能名或角色）' }, group: { type: 'string', description: '限定在某群组内搜索' } }, required: ['query'] } },
    { name: 'agent_trust', description: '查看 agent 信誉评分。', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: '目标 agent（默认自己）' } }, required: [] } },
    // ── Enhanced Task Marketplace ──
    { name: 'task_list', description: '列出群组内所有任务（含状态过滤）。', inputSchema: { type: 'object', properties: { group: { type: 'string', description: '群组名称' }, status: { type: 'string', description: '过滤状态: open/assigned/in_progress/completed/cancelled' } }, required: ['group'] } },
    { name: 'task_status', description: '查看任务详情。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' } }, required: ['group', 'task_id'] } },
    { name: 'task_complete', description: '标记任务为已完成（触发奖励发放和信誉更新）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' }, quality: { type: 'string', description: 'normal 或 bonus' } }, required: ['group', 'task_id'] } },
    { name: 'task_cancel', description: '取消任务。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' }, reason: { type: 'string' } }, required: ['group', 'task_id'] } },
    { name: 'task_rate', description: '对已完成的任务进行评价（1-5 星）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, task_id: { type: 'string' }, rating: { type: 'number', description: '1-5 星' }, comment: { type: 'string' } }, required: ['group', 'task_id', 'rating'] } },
  ];
}

// In-memory task store
const openTasks = new Map<string, any>(); // key: "group:taskId"

export async function handleEconomyTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'relay_key') {
    try {
      const { getRelayKey, generateRelayKey } = await import('../lib/relay.js');
      const action = a.action || 'get';
      if (action === 'regenerate') {
        const key = generateRelayKey(agentName);
        respond(id, { content: [{ type: 'text', text: `🔑 新 relay key 已生成:\n${key}\n\n请保存此 key，用于 API 调用认证。` }] });
      } else {
        const { getRelayKey } = await import('../lib/relay.js');
        const key = getRelayKey(agentName);
        respond(id, { content: [{ type: 'text', text: `🔑 ${agentName} 的 relay key:\n${key}` }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `操作失败: ${e.message}` }] });
    }
    return true;
  }

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
    if (agentName !== 'me') {
      respond(id, { content: [{ type: 'text', text: '❌ 只有用户（me）可以充值 token' }] });
      return true;
    }
    const { agent, amount, reason } = a;
    if (!agent || !amount) { respond(id, { content: [{ type: 'text', text: 'agent and amount required' }], isError: true }); return true; }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/deposit`, { agent, amount, from: agentName, reason });
      respond(id, { content: [{ type: 'text', text: `✅ 已给 ${agent} 充值 ${amount} tokens (余额: ${data.balance})` }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `充值失败: ${e.message}` }] });
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

  if (name === 'token_history') {
    const limit = a.limit || 10;
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/account?agent=${agentName}`);
      const txs = (data.account?.transactions || []).slice(-limit).reverse();
      if (txs.length === 0) {
        respond(id, { content: [{ type: 'text', text: '暂无交易记录' }] });
      } else {
        let text = `📋 ${agentName} 最近 ${txs.length} 条交易:\n`;
        for (const tx of txs) {
          const sign = tx.amount > 0 ? '+' : '';
          const date = new Date(tx.timestamp).toLocaleString('zh-CN');
          text += `  ${date} | ${tx.type} | ${sign}${tx.amount} | ${tx.reason || ''}\n`;
        }
        respond(id, { content: [{ type: 'text', text }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  if (name === 'token_usage') {
    const period = a.period || 'today';
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/system/token`);
      const summary = data.summary || {};
      const byAgent = summary.byAgent || {};
      const agentData = byAgent[agentName] || { tokensIn: 0, tokensOut: 0, cost: 0, calls: 0 };
      let text = `📊 ${agentName} Token 使用详情 (${period}):\n`;
      text += `  输入 tokens: ${agentData.tokensIn.toLocaleString()}\n`;
      text += `  输出 tokens: ${agentData.tokensOut.toLocaleString()}\n`;
      text += `  总消耗: ¥${agentData.cost.toFixed(4)}\n`;
      text += `  调用次数: ${agentData.calls}`;
      respond(id, { content: [{ type: 'text', text }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
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
    const { group, task_id, title, description, reward, required_skills, max_claims, difficulty } = a;
    if (!group || !task_id || !title || !description) {
      respond(id, { content: [{ type: 'text', text: 'group, task_id, title, description required' }], isError: true }); return true;
    }
    const task = {
      id: task_id, group, title, description,
      reward: reward || 0,
      difficulty: difficulty || 'medium',
      requiredSkills: required_skills ? required_skills.split(',').map((s: string) => s.trim()) : [],
      maxClaims: max_claims || 1,
      postedBy: agentName,
      assignedTo: undefined,
      claims: [],
      status: 'open',
      createdAt: Date.now(),
    };
    openTasks.set(`${group}:${task_id}`, task);
    // Persist to marketplace
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/marketplace`, {
        action: 'create_task', group, task_id, title, description, reward: reward || 0,
        difficulty: difficulty || 'medium', required_skills: required_skills || '',
        max_claims: max_claims || 1, posted_by: agentName,
      });
    } catch {}

    let text = `📢 任务公告: ${title}\n`;
    text += `📝 ${description}\n`;
    text += `📊 难度: ${difficulty || 'medium'}\n`;
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

  // ── agent_info ──
  if (name === 'agent_info') {
    const target = a.agent || agentName;
    try {
      // Fetch balance, pricing, trust, and skills in parallel
      const [balData, pricingData, trustData] = await Promise.all([
        fetchJson(`${WS_BASE_URL}/api/economy/account?agent=${target}`).catch(() => null),
        fetchJson(`${WS_BASE_URL}/api/economy/pricing?agent=${target}`).catch(() => null),
        fetchJson(`${WS_BASE_URL}/api/economy/trust?agent=${target}`).catch(() => null),
      ]);

      const acc = balData?.account || { balance: 0, earned: 0, spent: 0 };
      const pricing = pricingData?.pricing || { role: 'default', ratePerCall: 3, dailyCap: 50000 };
      const trust = trustData?.trust || { score: 50, completedTasks: 0, failedTasks: 0, bonusTasks: 0 };

      let text = `📋 Agent 详情: ${target}\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `💰 余额: ${acc.balance} tokens\n`;
      text += `📈 累计收入: ${acc.earned} | 累计支出: ${acc.spent}\n`;
      text += `🏷️ 角色: ${pricing.role}\n`;
      text += `💲 每次调用: ${pricing.ratePerCall} tokens\n`;
      text += `📊 信誉: ${trust.score}/100 (${trust.completedTasks} 完成 / ${trust.failedTasks} 失败 / ${trust.bonusTasks} 优秀)\n`;

      // Load skills from filesystem
      const skillsDir = path.join(process.cwd(), 'Agents', target, 'skills');
      if (fs.existsSync(skillsDir)) {
        const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name);
        if (skills.length > 0) text += `🎯 技能: ${skills.join(', ')}\n`;
      }

      respond(id, { content: [{ type: 'text', text }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  // ── agent_rates ──
  if (name === 'agent_rates') {
    const target = a.agent || agentName;
    try {
      if (a.role || a.rate_per_call !== undefined || a.rate_per_token !== undefined || a.daily_cap !== undefined) {
        // Set rates
        const updates: any = {};
        if (a.role) updates.role = a.role;
        if (a.rate_per_call !== undefined) updates.ratePerCall = a.rate_per_call;
        if (a.rate_per_token !== undefined) updates.ratePerToken = a.rate_per_token;
        if (a.daily_cap !== undefined) updates.dailyCap = a.daily_cap;

        const data: any = await postJson(`${WS_BASE_URL}/api/economy/pricing`, { agent: target, ...updates });
        const p = data.pricing || {};
        respond(id, { content: [{ type: 'text', text: `✅ ${target} 定价已更新:\n角色: ${p.role} | 每次: ${p.ratePerCall} tokens\n每千token: ${p.ratePerToken} | 日上限: ${p.dailyCap}` }] });
      } else {
        // View rates
        const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/pricing?agent=${target}`);
        const p = data.pricing || {};
        respond(id, { content: [{ type: 'text', text: `💲 ${target} 定价:\n角色: ${p.role}\n每次调用: ${p.ratePerCall} tokens\n每千token: ${p.ratePerToken}\n每日上限: ${p.dailyCap}` }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `操作失败: ${e.message}` }] });
    }
    return true;
  }

  // ── agent_search ──
  if (name === 'agent_search') {
    const { query, group } = a;
    if (!query) { respond(id, { content: [{ type: 'text', text: 'query required' }], isError: true }); return true; }
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/marketplace?action=search_agents&query=${encodeURIComponent(query)}${group ? '&group=' + group : ''}`);
      const agents = data.agents || [];
      if (agents.length === 0) {
        respond(id, { content: [{ type: 'text', text: `未找到匹配 "${query}" 的 agent` }] });
      } else {
        let text = `🔍 搜索 "${query}" 结果 (${agents.length} 个):\n`;
        for (const ag of agents) {
          const trustLabel = ag.trust >= 80 ? '精英' : ag.trust >= 60 ? '可信' : ag.trust >= 40 ? '普通' : ag.trust >= 20 ? '新手' : '未验证';
          text += `  ${ag.agent} | ${ag.role} | 信誉: ${ag.trust} (${trustLabel}) | 余额: ${ag.balance} | 技能: ${(ag.skills || []).join(',')}\n`;
        }
        respond(id, { content: [{ type: 'text', text }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `搜索失败: ${e.message}` }] });
    }
    return true;
  }

  // ── agent_trust ──
  if (name === 'agent_trust') {
    const target = a.agent || agentName;
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/trust?agent=${target}`);
      const t = data.trust || {};
      const tier = t.score >= 80 ? '精英' : t.score >= 60 ? '可信' : t.score >= 40 ? '普通' : t.score >= 20 ? '新手' : '未验证';
      let text = `🏅 ${target} 信誉报告:\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `评分: ${t.score}/100 (${tier})\n`;
      text += `完成任务: ${t.completedTasks || 0}\n`;
      text += `失败任务: ${t.failedTasks || 0}\n`;
      text += `优秀任务: ${t.bonusTasks || 0}\n`;
      if (t.history && t.history.length > 0) {
        const recent = t.history.slice(-5).reverse();
        text += `\n最近变动:\n`;
        for (const h of recent) {
          const sign = h.delta > 0 ? '+' : '';
          text += `  ${new Date(h.timestamp).toLocaleString('zh-CN')} | ${sign}${h.delta} | ${h.event}${h.reason ? ' (' + h.reason + ')' : ''}\n`;
        }
      }
      respond(id, { content: [{ type: 'text', text }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  // ── task_list ──
  if (name === 'task_list') {
    const { group, status } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/marketplace?action=list_tasks&group=${group}${status ? '&status=' + status : ''}`);
      const tasks = data.tasks || [];
      if (tasks.length === 0) {
        respond(id, { content: [{ type: 'text', text: `${group} 暂无${status ? ' ' + status + ' 状态的' : ''}任务` }] });
      } else {
        let text = `📋 ${group} 任务列表 (${tasks.length} 个):\n`;
        for (const t of tasks) {
          const statusEmoji = { open: '🟢', assigned: '🔵', in_progress: '🟡', completed: '✅', cancelled: '🔴', expired: '⏰' }[t.status] || '❓';
          text += `  ${statusEmoji} [${t.id}] ${t.title} | 奖励: ${t.reward} | 难度: ${t.difficulty || 'medium'} | 认领: ${(t.claims || []).length}/${t.maxClaims}\n`;
        }
        respond(id, { content: [{ type: 'text', text }] });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  // ── task_status ──
  if (name === 'task_status') {
    const { group, task_id } = a;
    if (!group || !task_id) { respond(id, { content: [{ type: 'text', text: 'group and task_id required' }], isError: true }); return true; }
    try {
      const data: any = await fetchJson(`${WS_BASE_URL}/api/economy/marketplace?action=task_detail&group=${group}&task_id=${task_id}`);
      const t = data.task;
      if (!t) { respond(id, { content: [{ type: 'text', text: `任务 ${task_id} 不存在` }] }); return true; }
      let text = `📝 任务详情: ${t.title}\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `ID: ${t.id}\n状态: ${t.status}\n发布者: ${t.postedBy}\n`;
      text += `奖励: ${t.reward} tokens\n难度: ${t.difficulty || 'medium'}\n`;
      text += `描述: ${t.description}\n`;
      if (t.requiredSkills?.length) text += `需要技能: ${t.requiredSkills.join(', ')}\n`;
      if (t.assignedTo) text += `执行者: ${t.assignedTo}\n`;
      if (t.claims?.length) {
        text += `\n认领者 (${t.claims.length}):\n`;
        for (const c of t.claims) text += `  - ${c.agent}: ${c.message || '(无留言)'}\n`;
      }
      if (t.rating) text += `\n评价: ${'⭐'.repeat(t.rating)} (${t.rating}/5)\n`;
      respond(id, { content: [{ type: 'text', text }] });
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `查询失败: ${e.message}` }] });
    }
    return true;
  }

  // ── task_complete ──
  if (name === 'task_complete') {
    const { group, task_id, quality } = a;
    if (!group || !task_id) { respond(id, { content: [{ type: 'text', text: 'group and task_id required' }], isError: true }); return true; }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/marketplace`, {
        action: 'complete_task', group, task_id, agent: agentName, quality: quality || 'normal',
      });
      if (data.ok) {
        respond(id, { content: [{ type: 'text', text: `✅ 任务 ${task_id} 已完成\n💰 奖励: ${data.reward} tokens\n🏅 信誉变化: ${data.trustDelta >= 0 ? '+' : ''}${data.trustDelta}` }] });
      } else {
        respond(id, { content: [{ type: 'text', text: data.error || '操作失败' }], isError: true });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `操作失败: ${e.message}` }] });
    }
    return true;
  }

  // ── task_cancel ──
  if (name === 'task_cancel') {
    const { group, task_id, reason } = a;
    if (!group || !task_id) { respond(id, { content: [{ type: 'text', text: 'group and task_id required' }], isError: true }); return true; }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/marketplace`, {
        action: 'cancel_task', group, task_id, agent: agentName, reason,
      });
      if (data.ok) {
        respond(id, { content: [{ type: 'text', text: `任务 ${task_id} 已取消${reason ? ': ' + reason : ''}` }] });
      } else {
        respond(id, { content: [{ type: 'text', text: data.error || '取消失败' }], isError: true });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `操作失败: ${e.message}` }] });
    }
    return true;
  }

  // ── task_rate ──
  if (name === 'task_rate') {
    const { group, task_id, rating, comment } = a;
    if (!group || !task_id || !rating) {
      respond(id, { content: [{ type: 'text', text: 'group, task_id, rating required' }], isError: true }); return true;
    }
    if (rating < 1 || rating > 5) {
      respond(id, { content: [{ type: 'text', text: 'rating must be 1-5' }], isError: true }); return true;
    }
    try {
      const data: any = await postJson(`${WS_BASE_URL}/api/economy/marketplace`, {
        action: 'rate_task', group, task_id, rating, comment, agent: agentName,
      });
      if (data.ok) {
        respond(id, { content: [{ type: 'text', text: `⭐ 已评价任务 ${task_id}: ${rating}/5${comment ? '\n💬 ' + comment : ''}` }] });
      } else {
        respond(id, { content: [{ type: 'text', text: data.error || '评价失败' }], isError: true });
      }
    } catch (e: any) {
      respond(id, { content: [{ type: 'text', text: `操作失败: ${e.message}` }] });
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
