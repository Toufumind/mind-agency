/**
 * SDK Types Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isAssistantMsg,
  isUserMsg,
  isResultSuccess,
  isThinkingBlock,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  getTokenUsage,
} from '../src/lib/sdk-types';

describe('SDK Types', () => {
  it('should detect assistant message', () => {
    expect(isAssistantMsg({ type: 'assistant', message: {}, parent_tool_use_id: null, uuid: '1', session_id: '1' } as any)).toBe(true);
    expect(isAssistantMsg({ type: 'user', message: {}, parent_tool_use_id: null, uuid: '1', session_id: '1' } as any)).toBe(false);
  });

  it('should detect user message', () => {
    expect(isUserMsg({ type: 'user', message: {}, parent_tool_use_id: null, uuid: '1', session_id: '1' } as any)).toBe(true);
    expect(isUserMsg({ type: 'assistant', message: {}, parent_tool_use_id: null, uuid: '1', session_id: '1' } as any)).toBe(false);
  });

  it('should detect result success', () => {
    expect(isResultSuccess({ type: 'result', subtype: 'success', duration_ms: 0, duration_api_ms: 0, is_error: false, num_turns: 1, session_id: '1', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as any)).toBe(true);
    expect(isResultSuccess({ type: 'result', subtype: 'error_during_execution', duration_ms: 0, duration_api_ms: 0, is_error: true, num_turns: 1, session_id: '1', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as any)).toBe(false);
    expect(isResultSuccess({ type: 'assistant', message: {}, parent_tool_use_id: null, uuid: '1', session_id: '1' } as any)).toBe(false);
  });

  it('should detect thinking block', () => {
    expect(isThinkingBlock({ type: 'thinking', thinking: 'test' })).toBe(true);
    expect(isThinkingBlock({ type: 'text', text: 'test' } as any)).toBe(false);
  });

  it('should detect text block', () => {
    expect(isTextBlock({ type: 'text', text: 'test' })).toBe(true);
    expect(isTextBlock({ type: 'thinking', thinking: 'test' } as any)).toBe(false);
  });

  it('should detect tool use block', () => {
    expect(isToolUseBlock({ type: 'tool_use', name: 'test', id: '1', input: {} })).toBe(true);
    expect(isToolUseBlock({ type: 'text', text: 'test' } as any)).toBe(false);
  });

  it('should detect tool result block', () => {
    expect(isToolResultBlock({ type: 'tool_result', content: 'test', tool_use_id: '1' })).toBe(true);
    expect(isToolResultBlock({ type: 'text', text: 'test' } as any)).toBe(false);
  });

  it('should get token usage', () => {
    const msg = {
      type: 'result' as const,
      subtype: 'success' as const,
      duration_ms: 0,
      duration_api_ms: 0,
      is_error: false,
      num_turns: 1,
      session_id: '1',
      total_cost_usd: 0,
      result: '',
      stop_reason: 'end_turn',
      modelUsage: {},
      permission_denials: [],
      uuid: '1',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as any;
    const usage = getTokenUsage(msg);
    expect(usage).toBeTruthy();
    expect(usage!.input_tokens).toBe(100);
    expect(usage!.output_tokens).toBe(50);
  });

  it('should return null for no usage', () => {
    const usage = getTokenUsage({ type: 'result', subtype: 'success', duration_ms: 0, duration_api_ms: 0, is_error: false, num_turns: 1, session_id: '1', total_cost_usd: 0, result: '', stop_reason: 'end_turn', modelUsage: {}, permission_denials: [], uuid: '1' } as any);
    expect(usage).toBeNull();
  });
});
