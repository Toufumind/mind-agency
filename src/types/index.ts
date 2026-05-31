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
