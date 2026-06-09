/**
 * AgentProxy — unified agent representation in Next.js process.
 *
 * Consolidates ALL agent logic:
 *   - AgentConfig (config.json)
 *   - AgentState (mind-state.json)
 *   - AgentActivity (in-memory status)
 *   - Session management (chat history)
 *   - System prompt building (identity, MCP, etc.)
 *   - Provider selection and execution
 *   - Token usage tracking
 *   - claude.exe process (lifecycle-bound)
 *
 * Each agent has one proxy instance with its own claude.exe process.
 * Use AgentRegistry to get/create proxies.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR, MCP_DIR, MIND_DIR, default as DATA_DIR } from './data-dir';
import { agentCache } from './cache';
import { getEventBus, EventType, createEvent } from './event-bus';
import { randomUUID } from 'crypto';

import { getMemoryContext } from './memory';
import { loadGoalContext } from './cli-commands';

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

// ── Default values ────────────────────────────────────────

const DEFAULT_CONFIG: AgentConfig = {
  roles: [],
  autoRespondToEmail: false,
  autoProcessGroupInvites: false,
  notifyOnEmail: true,
  notifyOnGroupMention: true,
};

const DEFAULT_STATE: AgentState = { emailCheck: 0, groups: {} };

const DEFAULT_ACTIVITY: AgentActivity = { status: 'idle', detail: '', updatedAt: 0 };

// ── AgentProxy class ──────────────────────────────────────

export class AgentProxy {
  readonly name: string;

  private _config: AgentConfig = { ...DEFAULT_CONFIG };
  private _state: AgentState = { ...DEFAULT_STATE, groups: {} };
  private _activity: AgentActivity = { ...DEFAULT_ACTIVITY };
  private _configLoaded = false;
  private _stateLoaded = false;

  // Session
  private _session: ChatHistory = { sessionId: null, messages: [], _version: 0 };
  private _sessionLoaded = false;

  // claude.exe process (lifecycle-bound)
  private _warmQuery: any = null; // WarmQuery from SDK startup()
  private _processReady = false;
  private _processError: string | null = null;

  // Token usage
  private _tokenUsage = { input: 0, output: 0 };

  constructor(name: string) {
    this.name = name;
  }

  // ── Config ────────────────────────────────────────────

  get config(): AgentConfig {
    return this._config;
  }

  async loadConfig(): Promise<AgentConfig> {
    if (this._configLoaded) return this._config;

    const cached = agentCache.get<AgentConfig>('config', this.name);
    if (cached) {
      this._config = cached;
      this._configLoaded = true;
      return this._config;
    }

    try {
      const cf = path.join(AGENTS_DIR, this.name, 'config.json');
      if (fs.existsSync(cf)) {
        const data = JSON.parse(fs.readFileSync(cf, 'utf-8'));
        this._config = {
          roles: data.roles || [],
          permissions: data.permissions,
          autoRespondToEmail: data.autoRespondToEmail,
          autoProcessGroupInvites: data.autoProcessGroupInvites,
          notifyOnEmail: data.notifyOnEmail ?? true,
          notifyOnGroupMention: data.notifyOnGroupMention ?? true,
          behavior: data.behavior,
          provider: data.provider,
          model: data.model,
          apiKey: data.apiKey,
          baseUrl: data.baseUrl,
          permissionMode: data.permissionMode,
          allowedTools: data.allowedTools,
          disallowedTools: data.disallowedTools,
          maxTurns: data.maxTurns,
        };
        agentCache.set('config', this.name, this._config);
      }
    } catch {}

    this._configLoaded = true;
    return this._config;
  }

  async saveConfig(): Promise<void> {
    try {
      const agentDir = path.join(AGENTS_DIR, this.name);
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

      const cf = path.join(agentDir, 'config.json');
      fs.writeFileSync(cf, JSON.stringify(this._config, null, 2), 'utf-8');
      agentCache.invalidate('config', this.name);
    } catch (err) {
      console.error(`[agent-proxy] saveConfig(${this.name}):`, err);
    }
  }

  // ── State ─────────────────────────────────────────────

  get state(): AgentState {
    return this._state;
  }

  async loadState(): Promise<AgentState> {
    if (this._stateLoaded) return this._state;

    try {
      const file = path.join(AGENTS_DIR, this.name, 'chat', 'mind-state.json');
      if (fs.existsSync(file)) {
        this._state = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
      }
    } catch {}

    this._stateLoaded = true;
    return this._state;
  }

  async saveState(): Promise<void> {
    try {
      const stateDir = path.join(AGENTS_DIR, this.name, 'chat');
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

      const file = path.join(stateDir, 'mind-state.json');
      fs.writeFileSync(file, JSON.stringify(this._state, null, 2), 'utf-8');
      agentCache.invalidate('state', this.name);
    } catch (err) {
      console.error(`[agent-proxy] saveState(${this.name}):`, err);
    }
  }

  // ── Activity ──────────────────────────────────────────

  get activity(): AgentActivity {
    return this._activity;
  }

  setStatus(status: AgentStatus, detail: string = ''): void {
    this._activity = { status, detail, updatedAt: Date.now() };
  }

  clearStatus(): void {
    this.setStatus('idle', '');
  }

  // ── Session (Chat History) ────────────────────────────

  get session(): ChatHistory {
    return this._session;
  }

  async loadSession(): Promise<ChatHistory> {
    if (this._sessionLoaded) return this._session;

    const cached = agentCache.get<ChatHistory>('session', this.name);
    if (cached) {
      this._session = JSON.parse(JSON.stringify(cached));
      this._sessionLoaded = true;
      return this._session;
    }

    try {
      const file = path.join(AGENTS_DIR, this.name, 'chat', 'session.json');
      if (fs.existsSync(file)) {
        this._session = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (typeof this._session._version !== 'number') this._session._version = 0;
      }
    } catch {}

    this._sessionLoaded = true;
    agentCache.set('session', this.name, this._session);
    return this._session;
  }

  async saveSession(): Promise<void> {
    try {
      const sessionDir = path.join(AGENTS_DIR, this.name, 'chat');
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

      const file = path.join(sessionDir, 'session.json');
      const tmp = file + '.tmp';
      this._session._version = (this._session._version || 0) + 1;
      fs.writeFileSync(tmp, JSON.stringify(this._session, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
      agentCache.set('session', this.name, this._session);
    } catch (err) {
      console.error(`[agent-proxy] saveSession(${this.name}):`, err);
    }
  }

  clearSession(): void {
    this._session = { sessionId: null, messages: [], _version: 0 };
    this._sessionLoaded = true;
    try {
      const file = path.join(AGENTS_DIR, this.name, 'chat', 'session.json');
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
    agentCache.invalidate('session', this.name);
  }

  // ── Tasks ─────────────────────────────────────────────

  private _tasks: AgentTask[] = [];

  async loadTasks(): Promise<AgentTask[]> {
    try {
      const file = path.join(AGENTS_DIR, this.name, 'tasks.json');
      if (fs.existsSync(file)) {
        this._tasks = JSON.parse(fs.readFileSync(file, 'utf-8'));
      }
    } catch {}
    return this._tasks;
  }

  async saveTasks(): Promise<void> {
    try {
      const agentDir = path.join(AGENTS_DIR, this.name);
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

      const file = path.join(agentDir, 'tasks.json');
      fs.writeFileSync(file, JSON.stringify(this._tasks, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[agent-proxy] saveTasks(${this.name}):`, err);
    }
  }

  get tasks(): AgentTask[] {
    return this._tasks;
  }

  async addTask(task: AgentTask): Promise<void> {
    this._tasks.push(task);
    await this.saveTasks();
  }

  async completeTask(runId: string, result: string): Promise<void> {
    const task = this._tasks.find(t => t.runId === runId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      await this.saveTasks();
    }
  }

  // ── Token Usage ───────────────────────────────────────

  get tokenUsage(): { input: number; output: number } {
    return this._tokenUsage;
  }

  addTokenUsage(input: number, output: number): void {
    this._tokenUsage.input += input;
    this._tokenUsage.output += output;
  }

  // ── System Prompt Building ────────────────────────────

  buildIdentity(): string {
    const config = this._config;

    // Read agent's own CLAUDE.md
    let identity = this.readClaudeMd();
    if (!identity) {
      const claudeMdAlt = path.join(AGENTS_DIR, this.name, '.claude', 'CLAUDE.md');
      try {
        if (fs.existsSync(claudeMdAlt)) identity = fs.readFileSync(claudeMdAlt, 'utf-8').trim();
      } catch {}
    }
    if (!identity) identity = `你是${this.name}，Mind Agency 团队成员。`;

    // Append behavioral config
    const behavior = config.behavior;
    const behaviorLines: string[] = [];
    if (behavior) {
      if (behavior.style) behaviorLines.push(`- 风格: ${behavior.style}`);
      if (behavior.focus?.length) behaviorLines.push(`- 重点领域: ${behavior.focus.join(', ')}`);
      if (behavior.avoidTopics?.length) behaviorLines.push(`- 避免: ${behavior.avoidTopics.join(', ')}`);
    }
    if (behaviorLines.length > 0) identity += '\n\n【行为偏好】\n' + behaviorLines.join('\n');

    // Append L1/L2/L3 boundaries + tools reference
    identity += `\n\n【能力边界 — L1·L2·L3】
L1-你的领域: 自己的 chat session、.todo、email 收件箱（只看+删）、.mind 记忆。可自由操作。
L2-协议交互: 跟别人沟通用 group_send/group_read/email（写到对方 Agents/<name>/email/）。不要直接写其他 Agent 的文件。
L3-不可碰: 别人的 config.json、chat session、.todo。不要替别人发言。
违反 L2/L3 会破坏团队信任。

【工具速查】
你可以使用以下MCP工具：
- group_send: 向群组发消息
- group_read: 读取群组消息
- email_send: 发送邮件
- workflow_callback: 报告工作流步骤完成结果
- task: 报告任务进度
- learning_query: 查询团队学习记录

文件系统工具（备用）：
- Read/Write/Edit: 文件读写
- Bash: 执行命令

完成工作流任务后，请用 workflow_callback 工具报告结果：
workflow_callback(runId="...", stepId="...", status="COMPLETED", summary="结果摘要", details="详细说明")
始终用中文回复。`;

    return identity;
  }

  readClaudeMd(): string {
    try {
      const file = path.join(AGENTS_DIR, this.name, 'CLAUDE.md');
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8').trim();
    } catch {}
    return '';
  }

  getGroupMembership(): string {
    const groups: string[] = [];
    if (fs.existsSync(GROUPS_DIR)) {
      for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
        if (!g.isDirectory() || g.name.startsWith('.')) continue;
        const agDir = path.join(GROUPS_DIR, g.name, 'Agents');
        if (!fs.existsSync(agDir)) continue;
        if (fs.readdirSync(agDir, { withFileTypes: true }).some(
          e => e.isDirectory() && e.name.toLowerCase() === this.name.toLowerCase()
        )) {
          groups.push(g.name);
        }
      }
    }
    return groups.length > 0 ? `\n你所在的群组: ${groups.join(', ')}` : '';
  }

  buildGroupChatContext(groupName?: string): string {
    if (!groupName) return '';

    const chatDir = path.join(GROUPS_DIR, groupName, 'chat');
    if (!fs.existsSync(chatDir)) {
      return `\n群聊${groupName}:暂无消息,用group_send发言.`;
    }

    try {
      const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort();
      if (files.length === 0) {
        return `\n群聊${groupName}:暂无消息,用group_send发言.`;
      }

      const recentFiles = files.slice(-10);
      const msgs: string[] = [];
      for (const f of recentFiles) {
        try {
          const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
          const truncated = raw.length > 1500 ? raw.slice(-1500) : raw;
          msgs.push(`[${f.replace('.md', '')}]\n${truncated}`);
        } catch {}
      }
      return `\n群聊${groupName}最近消息:\n${msgs.join('\n---\n')}`;
    } catch {
      return `\n群聊${groupName}:读取失败.`;
    }
  }

  buildMcpConfig(): Record<string, unknown> {
    const isWin = process.platform === 'win32';
    const electronExe = process.env.MIND_ELECTRON_EXE;
    const envBase: Record<string, string> = {
      MIND_DATA_DIR: DATA_DIR, MIND_API_URL: 'http://127.0.0.1:3000',
      WS_BASE_URL: 'http://127.0.0.1:3001',
    };

    const bundledPath = path.resolve(MCP_DIR, 'group-server.mjs');
    const sourcePath = path.resolve(MCP_DIR, 'group-server.ts');
    const serverPath = fs.existsSync(bundledPath) ? bundledPath : sourcePath;
    const useTsx = serverPath.endsWith('.ts');

    if (electronExe) {
      return { 'group-chat': { command: electronExe, args: [serverPath, this.name], cwd: DATA_DIR, env: { ELECTRON_RUN_AS_NODE: '1', ...envBase } } };
    }

    if (isWin) {
      if (useTsx) {
        return { 'group-chat': { command: 'cmd.exe', args: ['/c', 'npx.cmd', 'tsx', serverPath, this.name], env: { ...envBase, PATH: process.env.PATH } } };
      }
      return { 'group-chat': { command: 'node', args: [serverPath, this.name], env: envBase } };
    }

    if (useTsx) {
      return { 'group-chat': { command: 'npx', args: ['tsx', serverPath, this.name], cwd: DATA_DIR, env: envBase } };
    }
    return { 'group-chat': { command: 'node', args: [serverPath, this.name], cwd: DATA_DIR, env: envBase } };
  }

  buildSystemPrompt(groupName?: string): string {
    const memCtx = getMemoryContext(this.name);
    const goalsCtx = loadGoalContext(this.name);
    const groupCtx = this.buildGroupChatContext(groupName);

    let prompt = this.buildIdentity();
    prompt += '\n' + this.getGroupMembership();
    if (memCtx) prompt += '\n' + memCtx;
    if (goalsCtx) prompt += '\n\n---\n\n' + goalsCtx;
    if (groupCtx) prompt += groupCtx;

    return prompt;
  }

  // ── Chat (via claude.exe) ──────────────────────────────

  async chat(userMessage: string, groupName?: string): Promise<ChatResult> {
    this.setStatus('chatting', 'Processing...');

    try {
      await this.loadSession();
      await this.loadConfig();

      // Ensure claude.exe process is running
      if (!this._processReady) {
        await this.startProcess();
      }
      if (!this._warmQuery) {
        throw new Error(`claude.exe not available for ${this.name}`);
      }

      // Build prompt
      const systemPrompt = this.buildSystemPrompt(groupName);
      const fullPrompt = groupName
        ? this.buildGroupChatContext(groupName) + '\n\n---\n\n' + userMessage
        : userMessage;

      // Build MCP config
      const mcpServers = this.buildMcpConfig();

      // Send to claude.exe via SDK
      const query = this._warmQuery.query(fullPrompt);
      let reply = '';
      const events: ChatEvent[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const msg of query) {
        // SDK message types
        if (msg.type === 'assistant') {
          // Process content blocks
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'text') {
                reply += block.text || '';
                events.push({ type: 'text', content: block.text, timestamp: new Date().toISOString() });
              } else if (block.type === 'tool_use') {
                events.push({
                  type: 'tool_use',
                  content: block.name,
                  toolName: block.name,
                  toolInput: JSON.stringify(block.input, null, 2),
                  timestamp: new Date().toISOString(),
                });
              } else if (block.type === 'tool_result') {
                events.push({
                  type: 'tool_result',
                  content: block.content,
                  toolName: block.tool_use_id,
                  toolOutput: typeof block.content === 'string' ? block.content.slice(0, 500) : '',
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } else if (typeof msg.content === 'string') {
            reply += msg.content;
            events.push({ type: 'text', content: msg.content, timestamp: new Date().toISOString() });
          }
        } else if (msg.type === 'result') {
          // Token usage from result
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens || 0;
            outputTokens = msg.usage.output_tokens || 0;
          }
          events.push({ type: 'done', timestamp: new Date().toISOString() });
        }
      }

      // Save to session
      this._session.messages.push(
        { role: 'user', content: userMessage, timestamp: new Date().toISOString() },
        { role: 'assistant', content: reply, events, timestamp: new Date().toISOString() }
      );

      // Keep last 100 messages
      if (this._session.messages.length > 100) {
        this._session.messages = this._session.messages.slice(-100);
      }

      await this.saveSession();
      this.addTokenUsage(inputTokens, outputTokens);
      this.clearStatus();

      return {
        reply,
        events,
        sessionId: this._session.sessionId || '',
        tokenUsage: { input: inputTokens, output: outputTokens },
      };
    } catch (err: any) {
      this.clearStatus();
      console.error(`[agent-proxy] ${this.name}: chat error:`, err.message);
      throw err;
    }
  }

  // ── claude.exe Process (lifecycle-bound) ──────────────

  /**
   * Start the claude.exe process for this agent.
   * Must be called before sending any prompts.
   */
  async startProcess(): Promise<void> {
    if (this._processReady) return;
    if (this._processError) {
      console.log(`[agent-proxy] ${this.name}: process previously failed: ${this._processError}`);
      return;
    }

    try {
      console.log(`[agent-proxy] ${this.name}: starting claude.exe...`);

      // Build options for SDK
      const opts: any = {
        cwd: path.join(AGENTS_DIR, this.name),
        systemPrompt: this.buildSystemPrompt(),
        mcpServers: this.buildMcpConfig(),
        permissionMode: this._config.permissionMode || 'bypassPermissions',
        allowedTools: this._config.allowedTools?.length ? this._config.allowedTools : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
        ...(this._config.disallowedTools?.length ? { disallowedTools: this._config.disallowedTools } : {}),
      };

      // Apply model config (from agent config or global settings)
      if (this._config.model) {
        opts.model = this._config.model;
      } else {
        // Try to get from global settings
        try {
          const settingsPath = path.join(MIND_DIR, 'settings.json');
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            if (settings.model) opts.model = settings.model;
          }
        } catch {}
      }

      // SDK binary path
      const sdkBin = process.env.CLAUDE_CODE_PATH
        || ['node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
            '../node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
            'resources/app/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']
            .map(p => path.resolve(process.cwd(), p))
            .find(p => fs.existsSync(p));

      if (sdkBin) {
        opts.pathToClaudeCodeExecutable = sdkBin;
      }

      // Pre-warm the process
      const { startup } = await import('@anthropic-ai/claude-agent-sdk');
      this._warmQuery = await startup({ options: opts });
      this._processReady = true;
      console.log(`[agent-proxy] ${this.name}: claude.exe ready`);
    } catch (err: any) {
      this._processError = err.message;
      console.error(`[agent-proxy] ${this.name}: failed to start claude.exe:`, err.message);
    }
  }

  /**
   * Stop the claude.exe process for this agent.
   */
  stopProcess(): void {
    if (this._warmQuery) {
      try {
        this._warmQuery.close();
      } catch {}
      this._warmQuery = null;
      this._processReady = false;
      this._processError = null;
      console.log(`[agent-proxy] ${this.name}: claude.exe stopped`);
    }
  }

  /**
   * Check if the process is ready.
   */
  get isProcessReady(): boolean {
    return this._processReady;
  }

  // ── EventBus ──────────────────────────────────────────

  emitEvent(event: EventType, payload: Record<string, unknown>): void {
    try {
      const bus = getEventBus();
      bus.emit(createEvent(event, payload, this.name));
    } catch {}
  }

  emitStatusChanged(status: string): void {
    this.emitEvent(EventType.AGENT_STATUS_CHANGED, {
      agent: this.name,
      status,
      since: Date.now(),
    });
  }

  // ── Cleanup ───────────────────────────────────────────

  invalidateCache(): void {
    agentCache.invalidateAgent(this.name);
    this._configLoaded = false;
    this._stateLoaded = false;
    this._sessionLoaded = false;
  }

  destroy(): void {
    this.stopProcess();
    this.invalidateCache();
  }

  exists(): boolean {
    return fs.existsSync(path.join(AGENTS_DIR, this.name));
  }
}
