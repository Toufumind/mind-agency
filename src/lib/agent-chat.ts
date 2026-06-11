/**
 * agent-chat.ts — Chat orchestration extracted from AgentProxy.
 * Handles: system prompt building, MCP config, group context, token tracking.
 */

import { ChatHistory, ChatEvent } from './agent-types';

export interface ChatResult {
  reply: string;
  events: ChatEvent[];
  sessionId: string;
  tokenUsage: { input: number; output: number };
}

/** Build system prompt for agent */
export function buildSystemPrompt(agentName: string, config: any, groupContext?: string): string {
  const roles = config?.roles?.join(', ') || 'member';
  const autoReply = config?.autoRespondToEmail ? 'Yes' : 'No';
  return `You are ${agentName}, an AI agent with roles: ${roles}. Auto-reply: ${autoReply}.${groupContext ? '\n\nGroup context:\n' + groupContext : ''}`;
}

/** Build MCP server config for claude.exe */
export function buildMcpConfig(agentName: string, dataDir: string): Record<string, any> {
  return {
    'group-chat': {
      command: process.platform === 'win32' ? 'cmd.exe' : 'node',
      args: process.platform === 'win32'
        ? ['/c', 'npx.cmd', 'tsx', require('path').join(dataDir, 'mcp', 'group-server.ts'), agentName]
        : [require('path').join(dataDir, 'mcp', 'group-server.ts'), agentName],
    },
  };
}

/** Build group chat context */
export function buildGroupChatContext(groupName: string, chatDir: string): string {
  // Placeholder — actual implementation reads group chat history
  return `[Group: ${groupName}]`;
}

/** Parse streaming messages into reply + events */
export async function parseChatEvents(messages: AsyncIterable<any>): Promise<{ reply: string; events: ChatEvent[]; inputTokens: number; outputTokens: number }> {
  let reply = '';
  const events: ChatEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const msg of messages) {
    if (msg.type === 'assistant') {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            reply += block.text || '';
            events.push({ type: 'text', content: block.text, timestamp: new Date().toISOString() });
          } else if (block.type === 'tool_use') {
            events.push({ type: 'tool_use', content: block.name, toolName: block.name, toolInput: JSON.stringify(block.input, null, 2), timestamp: new Date().toISOString() });
          } else if (block.type === 'tool_result') {
            events.push({ type: 'tool_result', content: block.content, toolName: block.tool_use_id, toolOutput: typeof block.content === 'string' ? block.content.slice(0, 500) : '', timestamp: new Date().toISOString() });
          }
        }
      } else if (typeof msg.content === 'string') {
        reply += msg.content;
        events.push({ type: 'text', content: msg.content, timestamp: new Date().toISOString() });
      }
    } else if (msg.type === 'result') {
      if (msg.usage) { inputTokens = msg.usage.input_tokens || 0; outputTokens = msg.usage.output_tokens || 0; }
      events.push({ type: 'done', timestamp: new Date().toISOString() });
    }
  }
  return { reply, events, inputTokens, outputTokens };
}

/** Append messages to session, truncate to 100, save */
export function persistChat(session: ChatHistory, userMessage: string, reply: string, events: ChatEvent[], inputTokens: number, outputTokens: number): void {
  session.messages.push(
    { role: 'user', content: userMessage, timestamp: new Date().toISOString() },
    { role: 'assistant', content: reply, events, timestamp: new Date().toISOString() }
  );
  if (session.messages.length > 100) {
    session.messages = session.messages.slice(-100);
  }
}
