/**
 * Claude Provider — wraps @anthropic-ai/claude-agent-sdk
 *
 * Uses the existing SDK's query() function with session persistence.
 * Supports DeepSeek via ANTHROPIC_BASE_URL.
 */

import fs from 'fs';
import path from 'path';
import type { AgentProvider, SpawnOptions } from './index';
import { registerProvider } from './index';
import type { ChatEvent } from '../chat';

const sdkBinPaths = [
  'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
  '../node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
  'resources/app/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
];

class ClaudeProvider implements AgentProvider {
  name = 'claude';
  displayName = 'Claude (Anthropic / DeepSeek)';

  isAvailable(): boolean {
    if (process.env.CLAUDE_CODE_PATH) return fs.existsSync(process.env.CLAUDE_CODE_PATH);
    return sdkBinPaths.some(p => fs.existsSync(path.resolve(process.cwd(), p)));
  }

  getDefaultModel(): string {
    return process.env.ANTHROPIC_MODEL || 'deepseek-v4-flash';
  }

  async *execute(spawnOpts: SpawnOptions): AsyncGenerator<ChatEvent> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const sdkOpts: any = {
      prompt: spawnOpts.prompt,
      options: {
        maxTurns: 20,
        systemPrompt: spawnOpts.systemPrompt || '',
        continue: !!spawnOpts.conversationId,
        sessionId: spawnOpts.conversationId || undefined,
        permissionMode: 'bypassPermissions',
      },
    };

    // Set MCP servers
    if (spawnOpts.mcpServers) {
      sdkOpts.options.mcpServers = spawnOpts.mcpServers;
    }

    // Model override
    if (spawnOpts.config?.model) {
      sdkOpts.options.model = spawnOpts.config.model;
    }

    // Find SDK binary
    const sdkBin = process.env.CLAUDE_CODE_PATH
      || sdkBinPaths
          .map(p => path.resolve(process.cwd(), p))
          .find(p => fs.existsSync(p));
    if (sdkBin) {
      sdkOpts.options.pathToClaudeCodeExecutable = sdkBin;
    }

    const messages = query(sdkOpts);

    for await (const msg of messages) {
      if ('session_id' in msg) {
        yield { type: 'text', content: '', timestamp: new Date().toISOString() };
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'thinking' && block.thinking) {
            yield { type: 'thinking', content: block.thinking, timestamp: new Date().toISOString() };
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_use', content: block.name, toolName: block.name, toolInput: JSON.stringify(block.input || {}, null, 2), timestamp: new Date().toISOString() };
          } else if (block.type === 'text' && block.text) {
            yield { type: 'text', content: block.text, timestamp: new Date().toISOString() };
          }
        }
      }

      if (msg.type === 'user' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (typeof block === 'object' && block !== null && 'type' in block && (block as any).type === 'tool_result') {
            const out = typeof (block as any).content === 'string' ? (block as any).content : JSON.stringify((block as any).content || '');
            yield { type: 'tool_result', content: out, toolName: '', toolOutput: out.slice(0, 500), timestamp: new Date().toISOString() };
          }
        }
      }

      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          // Done
        } else {
          yield { type: 'error', content: `Claude error: ${msg.subtype}`, timestamp: new Date().toISOString() };
        }
      }
    }
  }
}

registerProvider(new ClaudeProvider());
