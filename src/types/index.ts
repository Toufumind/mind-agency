export interface Agent {
  name: string;
  emailPath: string;
  emailCount: number;
  rulesContent: string;
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
