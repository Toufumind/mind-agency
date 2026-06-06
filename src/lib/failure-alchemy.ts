/**
 * Failure Alchemy — Learn from task failures.
 *
 * When a task fails:
 *   1. Catalyst: Analyze root cause, inject into agent context
 *   2. Antibody: Extract general rule, store in long-term memory
 *   3. Vaccine: Check if pattern-level issue, inject into all relevant agents
 *
 * Vaccines are checked before task execution and injected into prompts.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, MIND_DIR } from './data-dir';
import { writeMemory, searchMemory } from './memory';

// ── Types ────────────────────────────────────────────────

interface Vaccine {
  id: string;
  taskType: string;
  rule: string;
  createdAt: number;
  expiresAt: number;
  source: string; // agent that created it
}

interface FailureRecord {
  agent: string;
  taskType: string;
  error: string;
  timestamp: number;
  catalyst?: string;
  antibody?: string;
  vaccine?: string;
}

// ── Storage ──────────────────────────────────────────────

const VACCINES_FILE = path.join(MIND_DIR, 'vaccines.json');
const FAILURES_DIR = path.join(MIND_DIR, 'failures');

function ensureDirs(): void {
  if (!fs.existsSync(MIND_DIR)) fs.mkdirSync(MIND_DIR, { recursive: true });
  if (!fs.existsSync(FAILURES_DIR)) fs.mkdirSync(FAILURES_DIR, { recursive: true });
}

// ── Load/Save ────────────────────────────────────────────

function loadVaccines(): Vaccine[] {
  ensureDirs();
  try {
    if (fs.existsSync(VACCINES_FILE)) {
      return JSON.parse(fs.readFileSync(VACCINES_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveVaccines(vaccines: Vaccine[]): void {
  ensureDirs();
  fs.writeFileSync(VACCINES_FILE, JSON.stringify(vaccines, null, 2), 'utf-8');
}

// ── Core Functions ───────────────────────────────────────

/**
 * Analyze a task failure and create catalyst/antibody/vaccine.
 */
export async function onTaskFailed(
  agent: string,
  taskType: string,
  error: string
): Promise<void> {
  ensureDirs();

  const record: FailureRecord = {
    agent,
    taskType,
    error,
    timestamp: Date.now(),
  };

  // 1. Catalyst: Store failure context for this agent
  const catalyst = `任务失败分析 [${new Date().toISOString()}]:\n` +
    `- 任务类型: ${taskType}\n` +
    `- 错误信息: ${error}\n` +
    `- 建议: 避免类似的错误，检查相关参数`;
  record.catalyst = catalyst;

  // Write to agent's memory
  try {
    writeMemory(agent, `failure:${taskType}:${Date.now()}`, catalyst);
  } catch {}

  // 2. Antibody: Extract general rule (if pattern detected)
  const antibody = extractRule(error, taskType);
  if (antibody) {
    record.antibody = antibody;
    try {
      writeMemory(agent, `antibody:${hashString(antibody)}`, antibody);
    } catch {}
  }

  // 3. Vaccine: Check if this is a pattern-level issue
  const vaccine = checkAndCreateVaccine(agent, taskType, error);
  if (vaccine) {
    record.vaccine = vaccine.rule;
  }

  // Save failure record
  const recordFile = path.join(FAILURES_DIR, `${Date.now()}_${agent}.json`);
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');

  console.log(`[failure-alchemy] ${agent}: ${taskType} failed → catalyst + antibody + vaccine`);
}

/**
 * Extract a general rule from error message.
 */
function extractRule(error: string, taskType: string): string | null {
  const lowerError = error.toLowerCase();

  // Common error patterns → rules
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
    return `超时规则: 任务 ${taskType} 可能需要更长的超时时间或更少的步骤`;
  }
  if (lowerError.includes('rate limit') || lowerError.includes('429')) {
    return `速率限制: 任务 ${taskType} 触发了 API 速率限制，需要添加延迟`;
  }
  if (lowerError.includes('permission') || lowerError.includes('403')) {
    return `权限规则: 任务 ${taskType} 需要更高权限，检查 agent 配置`;
  }
  if (lowerError.includes('not found') || lowerError.includes('404')) {
    return `资源缺失: 任务 ${taskType} 依赖的资源不存在，检查文件路径`;
  }
  if (lowerError.includes('memory') || lowerError.includes('heap')) {
    return `内存不足: 任务 ${taskType} 消耗过多内存，考虑分批处理`;
  }
  if (lowerError.includes('json') || lowerError.includes('parse')) {
    return `数据格式: 任务 ${taskType} 遇到 JSON 解析错误，检查输入数据`;
  }

  return null; // No general rule extracted
}

/**
 * Check if this is a pattern-level issue and create vaccine.
 */
function checkAndCreateVaccine(agent: string, taskType: string, error: string): Vaccine | null {
  const vaccines = loadVaccines();

  // Check if similar vaccine already exists
  const existing = vaccines.find(v =>
    v.taskType === taskType &&
    v.expiresAt > Date.now()
  );

  if (existing) {
    // Update existing vaccine (extend expiry)
    existing.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    existing.rule = extractRule(error, taskType) || existing.rule;
    saveVaccines(vaccines);
    return existing;
  }

  // Create new vaccine if rule was extracted
  const rule = extractRule(error, taskType);
  if (!rule) return null;

  const vaccine: Vaccine = {
    id: `vaccine:${taskType}:${Date.now()}`,
    taskType,
    rule,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    source: agent,
  };

  vaccines.push(vaccine);
  saveVaccines(vaccines);
  return vaccine;
}

/**
 * Get vaccines for a task type (before execution).
 */
export function getVaccines(taskType: string): string[] {
  const vaccines = loadVaccines();
  const now = Date.now();
  return vaccines
    .filter(v => v.taskType === taskType && v.expiresAt > now)
    .map(v => v.rule);
}

/**
 * Get all active vaccines.
 */
export function getAllVaccines(): Vaccine[] {
  const vaccines = loadVaccines();
  const now = Date.now();
  return vaccines.filter(v => v.expiresAt > now);
}

/**
 * Clean up expired vaccines.
 */
export function cleanExpiredVaccines(): number {
  const vaccines = loadVaccines();
  const now = Date.now();
  const before = vaccines.length;
  const active = vaccines.filter(v => v.expiresAt > now);
  saveVaccines(active);
  return before - active.length;
}

// ── Helpers ──────────────────────────────────────────────

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Inject vaccine hints into a task prompt.
 */
export function injectVaccines(prompt: string, taskType: string): string {
  const vaccines = getVaccines(taskType);
  if (vaccines.length === 0) return prompt;

  const vaccineHint = '\n\n[历史教训]\n' + vaccines.map(v => `- ${v}`).join('\n');
  return prompt + vaccineHint;
}
