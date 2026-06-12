/**
 * CLI Command Handler — makes Claude Code slash commands work in SDK mode.
 *
 * Claude Code CLI intercepts `/goal`, `/plan`, `/compact`, `/rename` at the
 * input parser level — they never reach the model. But SDK `query()` bypasses
 * this parser. This module re-implements those commands on the backend.
 *
 * Strategy per command:
 *   /goal <text>    → Persist to agent state, inject into system prompt
 *   /plan <topic>   → Set permissionMode='plan' + planModeInstructions
 *   /compact        → Summarize session.json, reset, inject summary
 *   /rename <name>  → Call SDK renameSession() with the session ID
 *   Others          → Pass through (model handles /review, /commit etc natively)
 */

import { renameSession } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { atomicWrite } from './atomic';

const AGENTS_DIR = process.env.MIND_DATA_DIR
  ? path.join(process.env.MIND_DATA_DIR, 'Agents')
  : path.join(process.cwd(), 'Agents');

// ── Goal persistence ─────────────────────────────────

function goalsFile(agentName: string): string {
  return path.join(AGENTS_DIR, agentName, 'chat', 'goals.json');
}

function loadGoals(agentName: string): string[] {
  try {
    if (fs.existsSync(goalsFile(agentName))) {
      return JSON.parse(fs.readFileSync(goalsFile(agentName), 'utf-8'));
    }
  } catch {}
  return [];
}

function saveGoals(agentName: string, goals: string[]): void {
  
  atomicWrite(goalsFile(agentName), JSON.stringify(goals, null, 2));
}

// ── Public API ──────────────────────────────────────

export interface CliResult {
  handled: boolean;
  /** For commands that return a direct message (no AI streaming) */
  directReply?: string;
  /** For commands that modify the streaming session */
  optsOverrides?: Record<string, unknown>;
  /** Whether to skip the normal user message save */
  skipNormalSave?: boolean;
}

/**
 * Parse a message for CLI commands and handle them.
 * Returns handled=false if the message should pass through to createChatStream normally.
 */
export function handleCliCommand(agentName: string, message: string, sessionId: string): CliResult {
  const m = message.match(/^\/(\w+)\s*(.*)/);
  if (!m) return { handled: false };

  const cmd = m[1].toLowerCase();
  const args = m[2].trim();

  switch (cmd) {
    case 'goal':
      return handleGoal(agentName, args);
    case 'plan':
      return handlePlan(agentName, args);
    case 'compact':
      return handleCompact(agentName);
    case 'rename':
      return handleRename(agentName, args, sessionId, message);
    default:
      return { handled: false };
  }
}

// ── Goals context cache (using unified cache) ────────────
import { agentCache } from './cache';

export function invalidateGoalsCache(agentName?: string): void {
  if (agentName) {
    agentCache.invalidate('goals', agentName);
  } else {
    agentCache.invalidateRegion('goals');
  }
}

/**
 * Load active goals for system prompt injection.
 * Called from chat.ts during stream setup. Cached for performance.
 */
export function loadGoalContext(agentName: string): string {
  const cached = agentCache.get<string>('goals', agentName);
  if (cached !== null) return cached;

  const goals = loadGoals(agentName);
  const result = goals.length === 0 ? '' :
    `\n[当前会话目标]\n${goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;

  agentCache.set('goals', agentName, result);
  return result;
}

// ── Command handlers ────────────────────────────────

function handleGoal(agentName: string, args: string): CliResult {
  if (!args) {
    return {
      handled: true,
      directReply: `📋 **当前目标:**\n${loadGoals(agentName).map((g, i) => `${i + 1}. ${g}`).join('\n') || '无'}\n\n用法: \`/goal <目标描述>\``,
    };
  }
  const goals = loadGoals(agentName);
  goals.push(args);
  saveGoals(agentName, goals);
  invalidateGoalsCache(agentName); // Invalidate cache after modification
  return {
    handled: true,
    directReply: `✅ 目标已记录: "${args}"\n当前共 ${goals.length} 个活跃目标。你可以随时用 \`/goal\` 查看。`,
    skipNormalSave: false,
  };
}

function handlePlan(agentName: string, args: string): CliResult {
  // /plan enters read-only plan mode. The topic is passed as planModeInstructions.
  return {
    handled: true,
    optsOverrides: {
      permissionMode: 'plan',
      planModeInstructions: args
        ? `规划主题: ${args}\n请输出详细设计文档。`
        : '请输出详细设计文档。',
    },
  };
}

function handleCompact(_agentName: string): CliResult {
  // Compact is complex — requires summarizing the session. For now, prompt the AI
  // to summarize and we'll handle the reset in a follow-up.
  // Return handled=false so the message passes through; the AI will do the compaction.
  return { handled: false };
}

function handleRename(agentName: string, args: string, sessionId: string, _rawMsg: string): CliResult {
  if (!args || !sessionId) {
    return {
      handled: true,
      directReply: sessionId
        ? '请提供新名称: `/rename 新名称`'
        : '尚无活跃会话可重命名。先发一条消息建立会话。',
    };
  }
  // Fire-and-forget rename — don't block the response
  renameSession(sessionId, args, { dir: path.join(AGENTS_DIR, agentName) }).catch(() => {});
  return {
    handled: true,
    directReply: `✅ 会话已重命名为: "${args}"`,
  };
}
