/**
 * Codex Provider — local CLI integration
 *
 * Spawns the `codex` CLI process and communicates via stdin/stdout.
 * Similar approach to Claude provider — uses the local tool, not direct API.
 *
 * Codex CLI: https://github.com/openai/codex
 * Usage: codex "prompt" --quiet
 */

import { spawn, type ChildProcess } from 'child_process';
import type { AgentProvider, SpawnOptions } from './index';
import { registerProvider } from './index';
import type { ChatEvent } from '../chat';

class CodexProvider implements AgentProvider {
  name = 'codex';
  displayName = 'Codex (OpenAI CLI)';

  isAvailable(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync('codex --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getDefaultModel(): string {
    return process.env.CODEX_MODEL || 'o4-mini';
  }

  async *execute(spawnOpts: SpawnOptions): AsyncGenerator<ChatEvent> {
    const model = spawnOpts.config?.model || this.getDefaultModel();

    // Build the prompt with system context
    const fullPrompt = spawnOpts.systemPrompt
      ? `${spawnOpts.systemPrompt}\n\n---\n\n${spawnOpts.prompt}`
      : spawnOpts.prompt;

    // Spawn codex CLI
    const args = [fullPrompt, '--quiet', '--model', model];

    // Add approval mode for safety
    args.push('--full-auto');

    const proc = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: spawnOpts.config?.apiKey || process.env.OPENAI_API_KEY || '',
        CODEX_MODEL: model,
      },
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Wait for process to complete with 5-minute timeout
    await new Promise<void>((resolve, reject) => {
      const TIMEOUT_MS = 300_000; // 5 minutes
      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        reject(new Error(`Codex timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout) {
          reject(new Error(`Codex exited with code ${code}: ${stderr}`));
        } else {
          resolve();
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });
    });

    // Yield the response as text events
    if (stdout.trim()) {
      // Codex outputs the full response at once (not streaming by default)
      // Split into chunks for progressive display
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          yield { type: 'text', content: line + '\n', timestamp: new Date().toISOString() };
        }
      }
    }

    if (stderr && !stdout) {
      yield { type: 'error', content: `Codex error: ${stderr}`, timestamp: new Date().toISOString() };
    }
  }
}

registerProvider(new CodexProvider());
