/**
 * Workflow Trigger Manager — v0.4
 *
 * Supports multiple trigger types:
 *   - manual: only triggers on explicit call (default)
 *   - file_change: triggers when workflow.yaml mtime changes
 *   - schedule: triggers on cron schedule
 *   - event: triggers on EventBus event
 *
 * Called by scheduler.ts on each tick.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';
import { parseWorkflowYaml, type WorkflowTrigger } from './event-bus';
import { triggerWorkflow } from './workflow-bridge';

interface TriggerState {
  group: string;
  trigger: WorkflowTrigger;
  lastMtime: number;
  lastFire: number;
  cronNextFire: number;
}

const triggers = new Map<string, TriggerState>();
const CRON_INTERVAL = 60_000; // check cron every minute

/** Load all workflow triggers from disk */
export function loadTriggers(): void {
  triggers.clear();
  if (!fs.existsSync(GROUPS_DIR)) return;

  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const wfPath = path.join(GROUPS_DIR, g.name, 'workflow.yaml');
    if (!fs.existsSync(wfPath)) continue;

    try {
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = parseWorkflowYaml(raw);
      if (!def.trigger || def.trigger.type === 'manual') continue;

      const state: TriggerState = {
        group: g.name,
        trigger: def.trigger,
        lastMtime: fs.statSync(wfPath).mtimeMs,
        lastFire: 0,
        cronNextFire: 0,
      };

      // For file_change triggers, set up the watcher
      if (def.trigger.type === 'file_change') {
        const watchPath = def.trigger.watchFile
          ? path.join(PROJECT_ROOT, def.trigger.watchFile)
          : wfPath;
        state.lastMtime = fs.existsSync(watchPath) ? fs.statSync(watchPath).mtimeMs : 0;
      }

      // For schedule triggers, calculate next fire time
      if (def.trigger.type === 'schedule' && def.trigger.cron) {
        state.cronNextFire = calculateNextCronFire(def.trigger.cron);
      }

      triggers.set(g.name, state);
      console.log(`[trigger] Loaded: ${g.name} → ${def.trigger.type}${def.trigger.cron ? ` (${def.trigger.cron})` : ''}`);
    } catch { /* skip parse errors */ }
  }
}

/** Check all triggers — called by scheduler on each tick */
export function checkTriggers(): void {
  const now = Date.now();

  for (const [group, state] of triggers) {
    try {
      switch (state.trigger.type) {
        case 'file_change':
          checkFileChangeTrigger(group, state, now);
          break;
        case 'schedule':
          checkScheduleTrigger(group, state, now);
          break;
        case 'event':
          // Event triggers are handled by EventBus subscriptions (not implemented yet)
          break;
      }
    } catch (err) {
      console.error(`[trigger] Error checking ${group}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Check file-change trigger */
function checkFileChangeTrigger(group: string, state: TriggerState, now: number): void {
  const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
  const watchPath = state.trigger.watchFile
    ? path.join(PROJECT_ROOT, state.trigger.watchFile)
    : wfPath;

  if (!fs.existsSync(watchPath)) return;
  const currentMtime = fs.statSync(watchPath).mtimeMs;

  if (currentMtime > state.lastMtime) {
    const debounce = state.trigger.debounceMs || 5000;
    if (now - state.lastFire < debounce) return; // debounce

    console.log(`[trigger] File changed: ${watchPath} → triggering ${group}`);
    state.lastMtime = currentMtime;
    state.lastFire = now;
    triggerWorkflow(group).catch(err =>
      console.error(`[trigger] Failed to trigger ${group}: ${err.message}`)
    );
  }
}

/** Check schedule trigger (cron) */
function checkScheduleTrigger(group: string, state: TriggerState, now: number): void {
  if (!state.trigger.cron) return;
  if (now < state.cronNextFire) return;

  console.log(`[trigger] Cron fired: ${state.trigger.cron} → triggering ${group}`);
  state.lastFire = now;
  state.cronNextFire = calculateNextCronFire(state.trigger.cron);
  triggerWorkflow(group).catch(err =>
    console.error(`[trigger] Failed to trigger ${group}: ${err.message}`)
  );
}

/**
 * Simple cron parser — supports: minute hour day-of-month month day-of-week
 *
 * Strategy: start from now, increment minute-by-minute, and match against
 * each cron field. This avoids the bugs that come from setting individual
 * Date fields independently (overflow, order-of-operations issues).
 * Caps at 7 days to prevent runaway loops.
 */
function calculateNextCronFire(cron: string): number {
  const parts = cron.split(' ').map(p => p.trim());
  if (parts.length !== 5) return Date.now() + 3600_000; // fallback: 1 hour

  const [minField, hourField, domField, monthField, dowField] = parts;
  const now = new Date();
  // Start from the next whole minute
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const MAX_ITERATIONS = 7 * 24 * 60; // 7 days in minutes

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (matchesCronField(minField, candidate.getMinutes()) &&
        matchesCronField(hourField, candidate.getHours()) &&
        matchesCronField(domField, candidate.getDate()) &&
        matchesCronField(monthField, candidate.getMonth() + 1) &&
        matchesCronField(dowField, candidate.getDay())) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: 1 hour from now if no match found within 7 days
  return Date.now() + 3600_000;
}

/** Check if a numeric value matches a single cron field (wildcard, number, or range like "1-5") */
function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  // Range: e.g. "1-5" → match 1,2,3,4,5
  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1]);
    const hi = parseInt(rangeMatch[2]);
    return value >= lo && value <= hi;
  }
  // Comma-separated: e.g. "1,3,5"
  if (field.includes(',')) {
    return field.split(',').some(f => matchesCronField(f.trim(), value));
  }
  // Single number
  return parseInt(field) === value;
}

/** Get trigger status for a group */
export function getTriggerStatus(group: string): { type: string; active: boolean; nextFire?: number } | null {
  const state = triggers.get(group);
  if (!state) return null;
  return {
    type: state.trigger.type,
    active: true,
    nextFire: state.trigger.type === 'schedule' ? state.cronNextFire : undefined,
  };
}

/** Reload triggers for a specific group (after workflow.yaml changes) */
export function reloadTrigger(group: string): void {
  triggers.delete(group);
  const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
  if (!fs.existsSync(wfPath)) return;

  try {
    const raw = fs.readFileSync(wfPath, 'utf-8');
    const def = parseWorkflowYaml(raw);
    if (!def.trigger || def.trigger.type === 'manual') return;

    const state: TriggerState = {
      group,
      trigger: def.trigger,
      lastMtime: fs.statSync(wfPath).mtimeMs,
      lastFire: 0,
      cronNextFire: def.trigger.type === 'schedule' ? calculateNextCronFire(def.trigger.cron || '') : 0,
    };
    triggers.set(group, state);
    console.log(`[trigger] Reloaded: ${group} → ${def.trigger.type}`);
  } catch { /* skip */ }
}

const PROJECT_ROOT = process.env.MIND_DATA_DIR || process.cwd();
