/**
 * Workflow Engine v0.3 — re-export shim.
 *
 * Implementation lives in event-bus.ts (single file with EventBus + WorkflowEngine).
 * This module re-exports for backward-compatible imports.
 */

export {
  WorkflowEngine,
  parseWorkflowYaml,
  StepStatus,
  WorkflowStatus,
} from './event-bus.js';

export type {
  WorkflowStep,
  WorkflowDefinition,
  WorkflowRunRecord,
} from './event-bus.js';
