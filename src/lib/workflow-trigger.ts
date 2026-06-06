/**
 * Workflow Trigger Manager — v0.5
 *
 * Two trigger sources:
 *   1. Workflow-level trigger config (legacy, backward compatible)
 *   2. Trigger nodes in DAG (type: trigger)
 *
 * When a trigger fires, passes the triggerStepId to triggerWorkflow()
 * so the engine auto-completes that specific trigger node.
 *
 * Called by scheduler.ts on each tick.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';
import { parseWorkflowYaml, type WorkflowTrigger, type WorkflowStep } from './event-bus';
import { triggerWorkflow } from './workflow-bridge';

// Event trigger subscriptions (group → event type)
const eventSubscriptions = new Map<string, { eventType: string; subId: string }>();

interface TriggerState {
  group: string;
  trigger: WorkflowTrigger;
  triggerStepId?: string;  // DAG trigger node ID (if trigger is a step)
  lastMtime: number;
  lastFire: number;
  cronNextFire: number;
}

const triggers = new Map<string, TriggerState[]>();
const CRON_INTERVAL = 60_000;

/** Load all workflow triggers from disk — supports both workflow-level and DAG trigger nodes */
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
      const groupTriggers: TriggerState[] = [];

      // Source 1: Workflow-level trigger config (legacy)
      if (def.trigger && def.trigger.type !== 'manual') {
        const state = buildTriggerState(g.name, def.trigger, undefined, wfPath);
        if (state) groupTriggers.push(state);
      }

      // Source 2: DAG trigger nodes
      for (const step of def.steps) {
        if (step.type === 'trigger' && step.trigger && step.trigger.type !== 'manual') {
          const state = buildTriggerState(g.name, step.trigger, step.id, wfPath);
          if (state) groupTriggers.push(state);
        }
      }

      if (groupTriggers.length > 0) {
        triggers.set(g.name, groupTriggers);
        for (const t of groupTriggers) {
          console.log(`[trigger] Loaded: ${g.name} → ${t.trigger.type}${t.triggerStepId ? ` (step: ${t.triggerStepId})` : ''}${t.trigger.cron ? ` (${t.trigger.cron})` : ''}`);
        }
      }
    } catch { /* skip parse errors */ }
  }
}

function buildTriggerState(group: string, trigger: WorkflowTrigger, triggerStepId: string | undefined, wfPath: string): TriggerState | null {
  if (!trigger || trigger.type === 'manual') return null;

  const state: TriggerState = {
    group,
    trigger,
    triggerStepId,
    lastMtime: fs.statSync(wfPath).mtimeMs,
    lastFire: 0,
    cronNextFire: 0,
  };

  if (trigger.type === 'file_change') {
    const watchPath = trigger.watchFile
      ? path.join(process.env.MIND_DATA_DIR || process.cwd(), trigger.watchFile)
      : wfPath;
    state.lastMtime = fs.existsSync(watchPath) ? fs.statSync(watchPath).mtimeMs : 0;
  }

  if (trigger.type === 'schedule' && trigger.cron) {
    state.cronNextFire = calculateNextCronFire(trigger.cron);
  }

  return state;
}

/** Check all triggers — called by scheduler on each tick */
export function checkTriggers(): void {
  const now = Date.now();

  for (const [group, groupTriggers] of triggers) {
    for (const state of groupTriggers) {
      try {
        switch (state.trigger.type) {
          case 'file_change':
            checkFileChangeTrigger(group, state, now);
            break;
          case 'schedule':
            checkScheduleTrigger(group, state, now);
            break;
          case 'event':
            subscribeEventTrigger(group, state);
            break;
        }
      } catch (err) {
        console.error(`[trigger] Error checking ${group}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

function fire(group: string, state: TriggerState): void {
  state.lastFire = Date.now();
  if (state.trigger.type === 'schedule' && state.trigger.cron) {
    state.cronNextFire = calculateNextCronFire(state.trigger.cron);
  }
  console.log(`[trigger] Fired: ${group} → ${state.trigger.type}${state.triggerStepId ? ` (step: ${state.triggerStepId})` : ''}`);
  triggerWorkflow(group, state.triggerStepId).catch(err =>
    console.error(`[trigger] Failed to trigger ${group}: ${err.message}`)
  );
}

/** Check file-change trigger */
function checkFileChangeTrigger(group: string, state: TriggerState, now: number): void {
  const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
  const watchPath = state.trigger.watchFile
    ? path.join(process.env.MIND_DATA_DIR || process.cwd(), state.trigger.watchFile)
    : wfPath;

  if (!fs.existsSync(watchPath)) return;
  const currentMtime = fs.statSync(watchPath).mtimeMs;

  if (currentMtime > state.lastMtime) {
    const debounce = state.trigger.debounceMs || 5000;
    if (now - state.lastFire < debounce) return;
    state.lastMtime = currentMtime;
    fire(group, state);
  }
}

/** Check schedule trigger (cron) */
function checkScheduleTrigger(group: string, state: TriggerState, now: number): void {
  if (!state.trigger.cron) return;
  if (now < state.cronNextFire) return;
  fire(group, state);
}

/** Subscribe to EventBus event trigger */
function subscribeEventTrigger(group: string, state: TriggerState): void {
  const key = `${group}:${state.triggerStepId || 'workflow'}`;
  if (eventSubscriptions.has(key)) return;

  const eventType = state.trigger.eventType || 'task.completed';
  const debounce = state.trigger.debounceMs || 5000;

  import('./event-bus').then(({ getEventBus }) => {
    const bus = getEventBus();
    const subId = bus.subscribe(
      { event: eventType as any },
      { scope: 'events' },
      `trigger:${key}`,
      (msg: any) => {
        const now = Date.now();
        if (now - state.lastFire < debounce) return;
        if (state.trigger.eventFilter) {
          const filter = state.trigger.eventFilter;
          if (filter.group && msg.payload?.group !== filter.group) return;
          if (filter.agent && msg.payload?.agent !== filter.agent) return;
        }
        fire(group, state);
      }
    );
    eventSubscriptions.set(key, { eventType, subId });
    console.log(`[trigger] Subscribed to ${eventType} for ${group}${state.triggerStepId ? ` (step: ${state.triggerStepId})` : ''}`);
  });
}

/** Get trigger status for a group */
export function getTriggerStatus(group: string): { type: string; active: boolean; nextFire?: number }[] | null {
  const groupTriggers = triggers.get(group);
  if (!groupTriggers || groupTriggers.length === 0) return null;
  return groupTriggers.map(t => ({
    type: t.trigger.type,
    active: true,
    nextFire: t.trigger.type === 'schedule' ? t.cronNextFire : undefined,
  }));
}

/** Reload triggers for a specific group */
export function reloadTrigger(group: string): void {
  triggers.delete(group);
  const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
  if (!fs.existsSync(wfPath)) return;

  try {
    const raw = fs.readFileSync(wfPath, 'utf-8');
    const def = parseWorkflowYaml(raw);
    const groupTriggers: TriggerState[] = [];

    if (def.trigger && def.trigger.type !== 'manual') {
      const state = buildTriggerState(group, def.trigger, undefined, wfPath);
      if (state) groupTriggers.push(state);
    }

    for (const step of def.steps) {
      if (step.type === 'trigger' && step.trigger && step.trigger.type !== 'manual') {
        const state = buildTriggerState(group, step.trigger, step.id, wfPath);
        if (state) groupTriggers.push(state);
      }
    }

    if (groupTriggers.length > 0) triggers.set(group, groupTriggers);
    console.log(`[trigger] Reloaded: ${group} → ${groupTriggers.length} trigger(s)`);
  } catch { /* skip */ }
}

/**
 * Simple cron parser — minute-by-minute scan up to 7 days.
 */
function calculateNextCronFire(cron: string): number {
  const parts = cron.split(' ').map(p => p.trim());
  if (parts.length !== 5) return Date.now() + 3600_000;

  const [minField, hourField, domField, monthField, dowField] = parts;
  const candidate = new Date();
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const MAX_ITERATIONS = 7 * 24 * 60;
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
  return Date.now() + 3600_000;
}

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) return value >= parseInt(rangeMatch[1]) && value <= parseInt(rangeMatch[2]);
  if (field.includes(',')) return field.split(',').some(f => matchesCronField(f.trim(), value));
  return parseInt(field) === value;
}
