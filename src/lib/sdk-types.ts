/**
 * SDK Message Type Guards
 *
 * The @anthropic-ai/claude-agent-sdk emits a discriminated union of message
 * types over the AsyncGenerator. Instead of `(msg as any).message?.content`,
 * use these guards to get proper TypeScript narrowing.
 */

import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';

// ── Content block types (from BetaMessage.content array) ─────

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  content: string | unknown[];
  tool_use_id?: string;
}

// ── Token usage shape (from SDKResultSuccess.usage) ──────────

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  /** Per-model breakdown (e.g. { 'deepseek-v4-pro': { inputTokens, outputTokens } }) */
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; costUSD?: number }>;
}

// ── Type guards ──────────────────────────────────────────────

/** Narrow a raw SDK message to assistant (AI reply with content blocks). */
export function isAssistantMsg(m: SDKMessage): m is SDKAssistantMessage {
  return m.type === 'assistant';
}

/** Narrow a raw SDK message to user (tool_result feedback injected by SDK). */
export function isUserMsg(m: SDKMessage): m is SDKUserMessage {
  return m.type === 'user';
}

/** Narrow a raw SDK message to a successful result (carries usage + tokens). */
export function isResultSuccess(m: SDKMessage): m is SDKResultSuccess {
  return m.type === 'result' && (m as SDKResultSuccess).subtype === 'success';
}

/** Narrow a raw content block to a thinking/scratchpad block. */
export function isThinkingBlock(b: unknown): b is ThinkingBlock {
  return typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'thinking';
}

/** Narrow a raw content block to a text block. */
export function isTextBlock(b: unknown): b is TextBlock {
  return typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text';
}

/** Narrow a raw content block to a tool_use block. */
export function isToolUseBlock(b: unknown): b is ToolUseBlock {
  return typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_use';
}

/** Narrow a raw content block to a tool_result block. */
export function isToolResultBlock(b: unknown): b is ToolResultBlock {
  return typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_result';
}

/** Extract usage from a result message, or null. */
export function getTokenUsage(msg: SDKResultSuccess): TokenUsage | null {
  if (!msg.usage) return null;
  return {
    input_tokens: msg.usage.input_tokens || 0,
    output_tokens: msg.usage.output_tokens || 0,
    modelUsage: msg.modelUsage,
  };
}
