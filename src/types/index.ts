export type AgentRole = 'admin' | 'member' | 'reviewer' | 'deployer';

export interface AgentPermissions {
  canCreateGroup: boolean;
  canDeleteGroup: boolean;
  canDeploy: boolean;
}

export interface AgentConfig {
  autoRespondToEmail: boolean;
  autoProcessGroupInvites?: boolean;
  notifyOnEmail?: boolean;
  notifyOnGroupMention?: boolean;
  roles?: AgentRole[];
  permissions?: AgentPermissions;
}

export interface Agent {
  name: string;
  emailPath: string;
  emailCount: number;
  rulesContent: string;
  config?: AgentConfig;
}

export interface Email {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  filename: string;
}

export interface AgentStats {
  totalAgents: number;
  totalEmails: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status: 'success' | 'error';
}

// ── Event Bus types (v0.2) ────────────────────────────────────────────

export enum EventType {
  AGENT_STATUS_CHANGED = 'agent.status.changed',
  AGENT_ERROR = 'agent.error',
  TASK_CREATED = 'task.created',
  TASK_ASSIGNED = 'task.assigned',
  TASK_IN_PROGRESS = 'task.in_progress',
  TASK_COMPLETED = 'task.completed',
  TASK_BLOCKED = 'task.blocked',
  TASK_REVIEW_REQUESTED = 'task.review_requested',
  TASK_REVIEW_COMPLETED = 'task.review_completed',
  MESSAGE_SENT = 'message.sent',
  MESSAGE_MENTION = 'message.mention',
  POLL_RESULT = 'poll.result',
  POLL_ERROR = 'poll.error',
  WS_CONNECT = 'ws.connect',
  WS_DISCONNECT = 'ws.disconnect',
  EMAIL_RECEIVED = 'email.received',
  EMAIL_SENT = 'email.sent',
}

export enum EventBusError {
  E_DUPLICATE_SUB = 'E_DUPLICATE_SUB',
  E_INVALID_FILTER = 'E_INVALID_FILTER',
  E_SUB_NOT_FOUND = 'E_SUB_NOT_FOUND',
  E_EMIT_FAILED = 'E_EMIT_FAILED',
  E_BACKPRESSURE = 'E_BACKPRESSURE',
}

export interface EventMessage {
  event: EventType;
  payload: Record<string, unknown>;
  timestamp: number;
  source: string;
  id: string;
}

export interface SubscribeFilter {
  event?: EventType | EventType[];
  agent?: string;
  taskId?: string;
}

export interface SubscribeOptions {
  scope?: 'events' | 'messages' | 'all';
  replay?: boolean;
  since?: number;
}
