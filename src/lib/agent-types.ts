/**
 * agent-types.ts — All type definitions and default values for AgentProxy modules.
 */

// ── Types ─────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'processing' | 'chatting' | 'working';

export interface AgentConfig {
  roles: string[];
  permissions?: {
    canCreateGroup?: boolean;
    canDeleteGroup?: boolean;
    canDeploy?: boolean;
  };
  autoRespondToEmail?: boolean;
  autoProcessGroupInvites?: boolean;
  notifyOnEmail?: boolean;
  notifyOnGroupMention?: boolean;
  behavior?: {
    style?: string;
    focus?: string[];
    preferences?: Record<string, string>;
    avoidTopics?: string[];
  };
  // Provider config
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  // SDK config
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
}

export interface GroupState {
  chatCheck: number;
  emailCheck: number;
  lastMention?: string;
}

export interface AgentState {
  emailCheck: number;
  groups: Record<string, GroupState>;
}

export interface AgentActivity {
  status: AgentStatus;
  detail: string;
  updatedAt: number;
}

export interface AgentTask {
  runId: string;
  stepId: string;
  workflow: string;
  prompt: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  result?: string;
}

export interface ChatHistory {
  sessionId: string | null;
  messages: { role: 'user' | 'assistant'; content: string; events?: ChatEvent[]; timestamp: string }[];
  _version?: number;
}

export interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp: string;
}

export interface ChatResult {
  reply: string;
  events: ChatEvent[];
  sessionId: string;
  tokenUsage?: { input: number; output: number };
}

export interface Email {
  from: string;
  to: string;
  subject: string;
  body: string;
  filename: string;
  timestamp: number;
}

export interface AgentSkill {
  name: string;
  prompt?: string;
}

// ── Default values ────────────────────────────────────────

export const DEFAULT_CONFIG: AgentConfig = {
  roles: [],
  autoRespondToEmail: false,
  autoProcessGroupInvites: false,
  notifyOnEmail: true,
  notifyOnGroupMention: true,
};

export const DEFAULT_STATE: AgentState = { emailCheck: 0, groups: {} };

export const DEFAULT_ACTIVITY: AgentActivity = { status: 'idle', detail: '', updatedAt: 0 };
