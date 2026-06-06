/**
 * Agent Chat — Multi-provider backend (v0.4)
 *
 * Supports multiple AI providers via the provider abstraction layer.
 * Default: Claude Agent SDK with DeepSeek backend.
 * Alternative: Codex (OpenAI API).
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { getProvider, type AgentProvider } from './providers';

// Ensure providers are registered
import './providers/claude';
import './providers/codex';
import { AGENTS_DIR, GROUPS_DIR, MCP_DIR, MIND_DIR, default as DATA_DIR } from './data-dir';
import { getMemoryContext } from './memory';
import {
  isAssistantMsg, isUserMsg, isResultSuccess,
  isThinkingBlock, isTextBlock, isToolUseBlock, isToolResultBlock,
  getTokenUsage,
} from './sdk-types';
import { trackQuery, untrackQuery, killAllQueries } from './process-tracker';
import { loadGoalContext } from './cli-commands';
import { setActivity, clearActivity } from './agent-activity';
import { writeAudit } from './audit';

// ── Load API settings from frontend-configurable settings.json ──
// This syncs /settings page edits with what the SDK actually uses.
// Fallback: process.env (from .env.local or Electron env)

let settingsLoaded = false;

function loadApiSettings(): void {
  if (settingsLoaded) return;
  try {
    const settingsFile = path.join(MIND_DIR, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      // settings.json takes precedence over env vars (user explicitly configured via UI)
      if (s.apiKey) process.env.ANTHROPIC_AUTH_TOKEN = s.apiKey;
      if (s.baseUrl) process.env.ANTHROPIC_BASE_URL = s.baseUrl;
      if (s.model) process.env.ANTHROPIC_MODEL = s.model;
      console.log('[chat] API settings loaded from settings.json');
    }
  } catch {}
  settingsLoaded = true;
}

// Load on module init
loadApiSettings();

// Watch settings.json for runtime changes (user edits via /settings page)
// Also invalidates all agent caches so config changes propagate immediately.
let settingsWatcher: fs.FSWatcher | null = null;
try {
  const settingsFile = path.join(MIND_DIR, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    settingsWatcher = fs.watch(settingsFile, () => {
      const prevModel = process.env.ANTHROPIC_MODEL;
      settingsLoaded = false;
      loadApiSettings();
      if (process.env.ANTHROPIC_MODEL !== prevModel) {
        console.log(`[chat] model changed: ${prevModel || '(none)'} → ${process.env.ANTHROPIC_MODEL || '(none)'}`);
      }
      // Invalidate all agent caches — API key/URL/model change affects everyone
      for (const key of agentBaseOptions.keys()) invalidateAgentCache(key);
    });
  }
} catch { /* watcher optional */ }

// ── Per-agent config.json watchers ────────────────────────────
// Invalidate agent cache the moment their config.json or CLAUDE.md changes
// (edits via the /agents/[name] UI page or direct file writes).
const configWatchers = new Map<string, fs.FSWatcher>();
const watchDebounce = new Map<string, ReturnType<typeof setTimeout>>();

function watchAgentConfig(agentName: string): void {
  const configPath = path.join(AGENTS_DIR, agentName, 'config.json');
  const claudePath = path.join(AGENTS_DIR, agentName, 'CLAUDE.md');
  if (!fs.existsSync(configPath)) return;
  // Close any existing watcher for this agent
  const old = configWatchers.get(agentName);
  if (old) { try { old.close(); } catch {} }
  try {
    // Watch the agent directory — catches both config.json and CLAUDE.md changes
    const w = fs.watch(path.join(AGENTS_DIR, agentName), (eventType, filename) => {
      if (!filename || !/^(config\.json|CLAUDE\.md)$/.test(filename)) return;
      // Debounce 500ms — save operations fire multiple events
      const existing = watchDebounce.get(agentName);
      if (existing) clearTimeout(existing);
      watchDebounce.set(agentName, setTimeout(() => {
        watchDebounce.delete(agentName);
        const prev = (agentBaseOptions.get(agentName) as any)?.__ts;
        invalidateAgentCache(agentName);
        console.log(`[chat] ${agentName}/${filename} changed → cache invalidated (prev_ts=${prev || 'none'})`);
      }, 500));
    });
    configWatchers.set(agentName, w);
  } catch { /* permission issue on dir watch — non-fatal */ }
}

// Initial scan of existing agents
try {
  if (fs.existsSync(AGENTS_DIR)) {
    for (const entry of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) watchAgentConfig(entry.name);
    }
  }
} catch {}

// On new agent creation, the scheduler's tick() refreshes file watchers via
// refreshFileWatchers(). Also watch for new agent directories appearing.
let agentDirWatcher: fs.FSWatcher | null = null;
try {
  if (fs.existsSync(AGENTS_DIR)) {
    agentDirWatcher = fs.watch(AGENTS_DIR, (eventType, filename) => {
      if (!filename) return;
      // A new directory appearing → watch its config
      if (!configWatchers.has(filename)) watchAgentConfig(filename);
    });
  }
} catch {}

process.on('exit', () => {
  try { settingsWatcher?.close(); } catch {}
  try { agentDirWatcher?.close(); } catch {}
  for (const w of configWatchers.values()) try { w.close(); } catch {}
  for (const t of watchDebounce.values()) clearTimeout(t);
});

export function killAllClaudeProcesses(): number {
  return killAllQueries();
}

// ── Caches ──

const membershipCache = new Map<string, { data: string; ts: number }>();
const MEMBERSHIP_CACHE_TTL = 300_000;

export interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp: string;
}

export interface ChatHistory {
  sessionId: string | null;
  messages: { role: 'user' | 'assistant'; content: string; events?: ChatEvent[]; timestamp: string }[];
}

function sessionFile(agentName: string) {
  return path.join(AGENTS_DIR, agentName, 'chat', 'session.json');
}

export function getChatHistory(agentName: string): ChatHistory {
  const file = sessionFile(agentName);
  if (!fs.existsSync(file)) return { sessionId: null, messages: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return { sessionId: null, messages: [] }; }
}

function saveChatHistory(agentName: string, data: ChatHistory) {
  const dir = path.join(AGENTS_DIR, agentName, 'chat');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = sessionFile(agentName);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

export function clearChat(agentName: string) {
  const file = sessionFile(agentName);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  membershipCache.delete(agentName);
}

// ── Builders ──────────────────────────────────────────────

function buildIdentity(agentName: string): string {
  const config = getAgentConfig(agentName);

  // Read agent's own CLAUDE.md — this IS the agent's identity
  const claudeMdPath = path.join(AGENTS_DIR, agentName, 'CLAUDE.md');
  const claudeMdAlt = path.join(AGENTS_DIR, agentName, '.claude', 'CLAUDE.md');
  let identity = '';
  try {
    if (fs.existsSync(claudeMdPath)) identity = fs.readFileSync(claudeMdPath, 'utf-8').trim();
    else if (fs.existsSync(claudeMdAlt)) identity = fs.readFileSync(claudeMdAlt, 'utf-8').trim();
  } catch {}
  if (!identity) identity = `你是${agentName}，Mind Agency 团队成员。`;

  // Append behavioral config if agent has it
  const behavior = config.behavior;
  const behaviorLines: string[] = [];
  if (behavior) {
    if (behavior.style) behaviorLines.push(`- 风格: ${behavior.style}`);
    if (behavior.focus?.length) behaviorLines.push(`- 重点领域: ${behavior.focus.join(', ')}`);
    if (behavior.avoidTopics?.length) behaviorLines.push(`- 避免: ${behavior.avoidTopics.join(', ')}`);
  }
  if (behaviorLines.length > 0) identity += '\n\n【行为偏好】\n' + behaviorLines.join('\n');

  // Append L1/L2/L3 boundaries + tools reference (layer on top of identity)
  identity += `\n\n【能力边界 — L1·L2·L3】
L1-你的领域: 自己的 chat session、.todo、email 收件箱（只看+删）、.mind 记忆。可自由操作。
L2-协议交互: 跟别人沟通用 group_send/group_read/email（写到对方 Agents/<name>/email/）。不要直接写其他 Agent 的文件。
L3-不可碰: 别人的 config.json、chat session、.todo。不要替别人发言。
违反 L2/L3 会破坏团队信任。

【工具速查】
群聊: group_list(列出群组) | group_read(读消息) | group_send(发消息) | group_join/leave
邮件: email_send(to, subject, body) — 发邮件给其他 Agent
记忆: agent_memory(action='write'|'read'|'search'|'list'|'delete', key, value, query) — 记住重要信息
决策: decide(group, decision='APPROVED'|'REJECTED', reason) — 结构化审批/投票
工作流: workflow_trigger(group) | workflow_status(group) | workflow_approve(group, approvalId, decision)
管理: group_create | group_invite | agent_create(name, roles)
始终用中文回复。`;

  return identity;
}

/** Read agent config.json — cached in memory */
interface AgentFullConfig {
  roles: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  /** Behavior profile — injected into system prompt */
  behavior?: {
    style?: string;        // e.g. "直接、简洁" or "温和、细致"
    focus?: string[];      // e.g. ["代码审查", "安全审计"]
    preferences?: Record<string, string>; // e.g. { "decision": "偏保守", "review": "严格" }
    avoidTopics?: string[]; // e.g. ["闲聊", "未经证实的猜测"]
  };
}

const configCache = new Map<string, AgentFullConfig>();
function getAgentConfig(agentName: string): AgentFullConfig {
  const cached = configCache.get(agentName);
  if (cached) return cached;
  try {
    const cf = path.join(AGENTS_DIR, agentName, 'config.json');
    if (fs.existsSync(cf)) {
      const data = JSON.parse(fs.readFileSync(cf, 'utf-8'));
      const cfg: AgentFullConfig = {
        roles: data.roles || [],
        allowedTools: data.allowedTools,
        disallowedTools: data.disallowedTools,
        permissionMode: data.permissionMode,
        maxTurns: data.maxTurns,
        behavior: data.behavior,
      };
      configCache.set(agentName, cfg);
      return cfg;
    }
  } catch {}
  const def = { roles: [] };
  configCache.set(agentName, def);
  return def;
}

function getGroupMembership(agentName: string): string {
  const now = Date.now();
  const cached = membershipCache.get(agentName);
  if (cached && (now - cached.ts) < MEMBERSHIP_CACHE_TTL) return cached.data;

  let result = '';
  if (fs.existsSync(GROUPS_DIR)) {
    const parts: string[] = [];
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const agD = path.join(GROUPS_DIR, g.name, 'Agents');
      if (!fs.existsSync(agD)) continue;
      const members = fs.readdirSync(agD, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      if (!members.some(m => m.toLowerCase() === agentName.toLowerCase())) continue;
      const others = members.filter(m => m !== agentName);
      const spec = fs.existsSync(path.join(GROUPS_DIR, g.name, 'TASK_SPEC.md')) ? ' [有任务规则]' : '';
      parts.push(`- ${g}: 成员 ${others.join(', ') || '无'}${spec}`);
    }
    if (parts.length > 0) result = '\n[所在群组]\n' + parts.join('\n');
  }
  membershipCache.set(agentName, { data: result, ts: now });
  return result;
}

function buildGroupChatContext(_agentName: string, groupName?: string): string {
  if (!groupName) return '';
  const chatDir = path.join(GROUPS_DIR, groupName, 'chat');
  if (!fs.existsSync(chatDir)) return `\n群聊${groupName}:暂无消息,用group_send发言.`;
  try {
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) return `\n群聊${groupName}:暂无消息,用group_send发言.`;
    // v0.4: Read last 5 files instead of just 1 (more context)
    const recentFiles = files.slice(-5);
    const msgs: string[] = [];
    for (const f of recentFiles) {
      try {
        const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
        const truncated = raw.length > 800 ? raw.slice(-800) : raw;
        msgs.push(`[${f.replace('.md','')}]\n${truncated}`);
      } catch {}
    }
    return `\n群聊${groupName}最近消息:\n${msgs.join('\n---\n')}`;
  } catch { return `\n群聊${groupName}:读取失败.`; }
}

/**
 * Build MCP server config for the SDK.
 *
 * Strategy: always prefer the pre-bundled `.mjs` (compiled from group-server.ts
 * via `scripts/build-mcp.mjs`). In dev, `npm run build:mcp` ensures it's fresh.
 * Fallback to `.ts` + `tsx` if `.mjs` doesn't exist (fresh checkout, Docker, CI).
 *
 * This eliminates ~200-500ms of `npx tsx` cold start per query.
 */
function buildMcpConfig(agentName: string) {
  const isWin = process.platform === 'win32';
  const electronExe = process.env.MIND_ELECTRON_EXE;
  const envBase: Record<string, string> = {
    MIND_DATA_DIR: DATA_DIR, MIND_PROJECT_ROOT: DATA_DIR, MIND_API_URL: 'http://127.0.0.1:3000',
  };

  // Prefer bundled .mjs, fallback to .ts
  const bundledPath = path.resolve(MCP_DIR, 'group-server.mjs');
  const sourcePath = path.resolve(MCP_DIR, 'group-server.ts');
  const serverPath = fs.existsSync(bundledPath) ? bundledPath : sourcePath;
  const useTsx = serverPath.endsWith('.ts');

  if (electronExe) {
    // Electron mode: run the MCP server inside Electron's Node.js
    return { 'group-chat': { command: electronExe, args: [serverPath, agentName], cwd: DATA_DIR, env: { ELECTRON_RUN_AS_NODE: '1', ...envBase } } };
  }

  if (isWin) {
    if (useTsx) {
      // Fallback: no .mjs yet
      return { 'group-chat': { command: 'cmd.exe', args: ['/c', 'npx.cmd', 'tsx', serverPath, agentName], cwd: DATA_DIR, env: envBase } };
    }
    // Direct node — no tsx overhead (~30ms vs ~300ms)
    return { 'group-chat': { command: 'node', args: [serverPath, agentName], cwd: DATA_DIR, env: envBase } };
  }

  // macOS / Linux
  if (useTsx) {
    return { 'group-chat': { command: 'npx', args: ['tsx', serverPath, agentName], cwd: DATA_DIR, env: envBase } };
  }
  return { 'group-chat': { command: 'node', args: [serverPath, agentName], cwd: DATA_DIR, env: envBase } };
}

// ── Shared options (stable across calls → cache hit) ──────
// We want a single set of base options per agent. The SDK picks
// up options from the previous session via `continue: true`.

const agentBaseOptions = new Map<string, Record<string, any>>();
// Short TTL: short enough that UI config edits propagate within a minute,
// long enough that prompt-cache prefixes stay stable across sequential calls.
const BASE_OPTIONS_TTL = 60_000; // 1 min

export function invalidateAgentCache(agentName: string): void {
  agentBaseOptions.delete(agentName);
  configCache.delete(agentName);
  membershipCache.delete(agentName);
}

function buildBaseOptions(agentName: string) {
  const key = agentName;
  const cached = agentBaseOptions.get(key);
  const now = Date.now();
  if (cached && (now - ((cached as any).__ts || 0)) < BASE_OPTIONS_TTL) return cached;

  const agentDir = path.join(AGENTS_DIR, agentName);
  // Memory context layer — agent carries past context across sessions
  const memCtx = getMemoryContext(agentName);
  const sysPrompt = buildIdentity(agentName) + '\n' + getGroupMembership(agentName) + (memCtx ? '\n' + memCtx : '');
  const mcpServers = buildMcpConfig(agentName);
  const agentConfig = getAgentConfig(agentName);

  const opts = {
    cwd: agentDir,
    systemPrompt: sysPrompt,
    mcpServers,
    permissionMode: agentConfig.permissionMode || 'bypassPermissions',
    allowedTools: agentConfig.allowedTools?.length ? agentConfig.allowedTools : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    ...(agentConfig.disallowedTools?.length ? { disallowedTools: agentConfig.disallowedTools } : {}),
    // maxTurns removed — agents can run indefinitely
  };

  (opts as any).__ts = Date.now();
  agentBaseOptions.set(key, opts);
  return opts;
}

/**
 * Save partial streaming state to `session.json` so users can navigate away
 * and come back without losing progress.
 *
 * Self-contained — inspects history to decide what to append:
 *   - Empty history → push {user, message}
 *   - Last entry is user → push {assistant, reply} (first content chunk)
 *   - Last entry is assistant → replace it (subsequent chunks)
 *
 * This eliminates the old `userMessageSaved` flag and 3× inline duplicates.
 */
function savePartialState(agentName: string, opts: {
  userMessage: string;
  fullReply: string;
  allEvents: ChatEvent[];
  sessionId: string;
}): void {
  const ih = getChatHistory(agentName);
  const last = ih.messages[ih.messages.length - 1];

  if (!last) {
    // No prior save — persist user message so it's visible immediately
    ih.messages.push({ role: 'user', content: opts.userMessage, timestamp: new Date().toISOString() });
  } else if (last.role === 'user') {
    // First content chunk — append partial assistant reply
    ih.messages.push({ role: 'assistant', content: opts.fullReply, events: [...opts.allEvents], timestamp: new Date().toISOString() });
  } else if (last.role === 'assistant') {
    // Subsequent chunk — replace the partial assistant reply
    last.content = opts.fullReply || last.content;
    last.events = [...opts.allEvents];
  }

  ih.sessionId = opts.sessionId || ih.sessionId;
  saveChatHistory(agentName, ih);
}

// ── Main stream ──────────────────────────────────────────

/**
 * @param fresh - When true, skip `continue: true` so SDK starts a brand new session.
 *   Used after /clear so the old session is fully discarded.
 */
// ── v0.4: Provider-based chat stream ─────────────────────

function loadAgentConfig(agentName: string): Record<string, unknown> | null {
  const cf = path.join(AGENTS_DIR, agentName, 'config.json');
  try { return fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf-8')) : null; }
  catch { return null; }
}

function createProviderStream(
  provider: AgentProvider, agentName: string, userMessage: string,
  groupName?: string, modelOverride?: string, agentConfig?: Record<string, unknown> | null,
): ReadableStream<ChatEvent> {
  const ts = () => new Date().toISOString();
  return new ReadableStream<ChatEvent>({
    async start(ctrl) {
      const allEvents: ChatEvent[] = [];
      let fullReply = '';
      setActivity(agentName, 'chatting', '对话中');
      const abortController = trackQuery();

      try {
        const baseOpts = buildBaseOptions(agentName);
        const groupChatCtx = buildGroupChatContext(agentName, groupName);
        const goalsCtx = loadGoalContext(agentName);
        const fullPrompt = groupChatCtx
          ? groupChatCtx + (goalsCtx ? '\n' + goalsCtx : '') + '\n\n---\n\n' + userMessage
          : (goalsCtx ? goalsCtx + '\n\n---\n\n' : '') + userMessage;

        // Build MCP servers config
        const mcpServers: Record<string, unknown> = {};
        const serverPath = path.join(MCP_DIR, 'group-server.mjs');
        if (fs.existsSync(serverPath)) {
          mcpServers['group-chat'] = {
            command: process.platform === 'win32' ? 'cmd.exe' : 'node',
            args: process.platform === 'win32'
              ? ['/c', 'node', serverPath, agentName]
              : [serverPath, agentName],
          };
        }

        const stream = provider.execute({
          agentName,
          prompt: fullPrompt,
          systemPrompt: baseOpts.systemPrompt,
          mcpServers,
          config: {
            model: modelOverride || (agentConfig as any)?.model,
            apiKey: (agentConfig as any)?.apiKey,
            baseUrl: (agentConfig as any)?.baseUrl,
          },
        });

        for await (const evt of stream) {
          allEvents.push(evt);
          ctrl.enqueue(evt);
          if (evt.type === 'text') { fullReply += evt.content || ''; }
        }
      } catch (err: any) {
        ctrl.enqueue({ type: 'error', content: err.message || String(err), timestamp: ts() });
      } finally {
        clearActivity(agentName);
        untrackQuery(abortController);
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        ctrl.close();
      }
    },
  });
}

export function createChatStream(agentName: string, userMessage: string, groupName?: string, modelOverride?: string, optsOverrides?: Record<string, unknown>, fresh?: boolean): ReadableStream<ChatEvent> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) return quickError(`Agent "${agentName}" not found`);

  // v0.4: Check agent's provider config — delegate to provider if non-Claude
  const agentConfig = loadAgentConfig(agentName);
  const providerName = (agentConfig?.provider as string) || 'claude';
  if (providerName !== 'claude') {
    const provider = getProvider(providerName);
    if (provider) {
      return createProviderStream(provider, agentName, userMessage, groupName, modelOverride, agentConfig);
    }
  }

  const baseOpts = buildBaseOptions(agentName);
  const groupChatCtx = buildGroupChatContext(agentName, groupName);
  // Inject persistent goals from /goal command
  const goalsCtx = loadGoalContext(agentName);
  const fullPrompt = groupChatCtx
    ? groupChatCtx + (goalsCtx ? '\n' + goalsCtx : '') + '\n\n---\n\n' + userMessage
    : (goalsCtx ? goalsCtx + '\n\n---\n\n' : '') + userMessage;
  const ts = () => new Date().toISOString();

  return new ReadableStream<ChatEvent>({
    async start(ctrl) {
      // Register in-memory active stream — frontend re-mounts can read via GET /api/.../chat
      const allEvents: ChatEvent[] = [];
      let fullReply = '';
      let sessionId = '';
      let hasContent = false;
      let incrementalSaveCounter = 0;
      // ── Activity tracking — visible in sidebar ──
      setActivity(agentName, 'chatting', '对话中');
      // ── Process tracking — enables clean shutdown ──
      // Declared before try so it's accessible in both try and catch blocks.
      const abortController = trackQuery();

      try {
        // In Electron, tell the SDK to use our Electron binary as the Node.js runtime.
        // SDK executes: <node> <claude-code-entry> --output-format stream-json ...
        const electronExe = process.env.MIND_ELECTRON_EXE;
        const opts: any = { ...baseOpts, abortController };
        if (!fresh) opts.continue = true;
        if (modelOverride) opts.model = modelOverride;
        if (electronExe) {
          (opts as any).executable = electronExe;
          process.env.ELECTRON_RUN_AS_NODE = '1';
        }

        // Apply CLI command overrides (from /plan, etc.)
        if (optsOverrides) {
          for (const [k, v] of Object.entries(optsOverrides)) {
            opts[k] = v;
          }
          if (optsOverrides.permissionMode === 'plan') {
            console.log(`[chat] plan mode: ${optsOverrides.planModeInstructions || '(no topic)'}`);
          }
        }

        // SDK binary path: use dynamic path resolution instead of require.resolve()
        // (require.resolve would make webpack try to bundle the .exe binary.)
        const sdkBin = process.env.CLAUDE_CODE_PATH
          || ['node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
              '../node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
              'resources/app/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']
              .map(p => path.resolve(process.cwd(), p))
              .find(p => fs.existsSync(p));
        if (sdkBin) {
          opts.pathToClaudeCodeExecutable = sdkBin;
          console.log('[chat] SDK binary:', sdkBin);
        } else {
          console.warn('[chat] SDK binary not found — SDK will use its own resolution');
        }

        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        const messages = query({ prompt: fullPrompt, options: opts });

        // Save user message immediately — visible even before first response chunk
        try { savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId }); } catch {}

        // v0.4: Timeout protection — if SDK hangs, show error after 30s
        let firstChunk = false;
        const timeout = setTimeout(() => {
          if (!firstChunk) {
            ctrl.enqueue({ type: 'error', content: 'Claude SDK 超时（30s 无响应）。请检查：1) API Key 是否配置 2) 网络是否正常 3) API 地址是否正确', timestamp: ts() });
            ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
            ctrl.close();
          }
        }, 30_000);

        for await (const msg of messages) {
          if (!firstChunk) { firstChunk = true; clearTimeout(timeout); }
          if ('session_id' in msg && !sessionId) sessionId = (msg as any).session_id;

          if (isAssistantMsg(msg)) {
            for (const block of msg.message?.content || []) {
              if (isThinkingBlock(block) && block.thinking) {
                allEvents.push({ type: 'thinking', content: block.thinking, timestamp: ts() });
                ctrl.enqueue(allEvents[allEvents.length - 1]);
                // Save during thinking phase too — user can leave and come back
                if (allEvents.filter(e => e.type === 'thinking').length % 3 === 0 && sessionId) {
                  try { savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId }); } catch {}
                }
              } else if (isToolUseBlock(block)) {
                allEvents.push({ type: 'tool_use', content: block.name, toolName: block.name, toolInput: JSON.stringify(block.input || {}, null, 2), timestamp: ts() });
                ctrl.enqueue(allEvents[allEvents.length - 1]);
                // v0.4: Save session on every tool call (prevents data loss on page switch)
                if (sessionId) { try { savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId }); } catch {} }
                // Audit log for file operations
                const input = block.input as Record<string, any> | undefined;
                const filePath = input?.file_path || input?.path || '';
                if (block.name === 'Write' || block.name === 'Edit' || block.name === 'Delete' || block.name === 'Rename') {
                  try { writeAudit({ agent: agentName, action: `file.${block.name.toLowerCase()}`, resource: filePath || 'unknown', details: block.name === 'Write' ? (input?.content || '').slice(0, 100) : '' }); } catch {}
                } else if (block.name === 'Bash') {
                  try { writeAudit({ agent: agentName, action: 'file.bash', resource: '', details: (input?.command || '').slice(0, 120) }); } catch {}
                }
              } else if (isTextBlock(block) && block.text) {
                fullReply += block.text; hasContent = true;
                allEvents.push({ type: 'text', content: block.text, timestamp: ts() });
                ctrl.enqueue(allEvents[allEvents.length - 1]);

                // ── Incremental save: every 8 text chunks, persist partial state ──
                // Allows users to navigate away and come back to see partial results.
                incrementalSaveCounter++;
                if (incrementalSaveCounter % 8 === 0 && sessionId) {
                  try { savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId }); } catch {}
                }
              }
            }
          }
          if (isUserMsg(msg)) {
            for (const block of msg.message?.content || []) {
              if (isToolResultBlock(block)) {
                const out = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
                allEvents.push({ type: 'tool_result', content: out.slice(0, 3000), toolOutput: out.slice(0, 3000), timestamp: ts() });
                ctrl.enqueue(allEvents[allEvents.length - 1]);
              }
            }
          }
          if (isResultSuccess(msg)) {
            if (msg.is_error && !hasContent) {
              ctrl.enqueue({ type: 'error', content: 'Execution error', timestamp: ts() });
            }
            // Record token usage (fire-and-forget via raw http — don't block stream)
            const usage = getTokenUsage(msg);
            if (usage) {
              const tokensIn = usage.input_tokens;
              const tokensOut = usage.output_tokens;
              const model = usage.modelUsage ? Object.keys(usage.modelUsage)[0] || 'unknown' : 'unknown';
              // DeepSeek pricing (CNY per 1M tokens), cache-miss by default
              // V4-Pro: input ¥3.00, output ¥6.00 | V4-Flash: input ¥1.00, output ¥2.00
              const isDS = /deepseek/i.test(model);
              const isFlash = isDS && /flash|chat/i.test(model) && !/pro/i.test(model);
              // Claude pricing fallback (CNY, ~7.2 rate):
              // Opus:  $15/$75 → ¥108/540 | Sonnet: $3/$15 → ¥21.6/108 | Haiku: $0.25/$1.25 → ¥1.8/9
              const isClaude = /claude/i.test(model);
              const isOpus = isClaude && /opus/i.test(model);
              const isSonnet = isClaude && /sonnet/i.test(model);
              const cost = isDS
                ? (tokensIn * (isFlash ? 1.0 : 3.0) + tokensOut * (isFlash ? 2.0 : 6.0)) / 1_000_000
                : Number(msg.total_cost_usd) || (isOpus ? (tokensIn * 108 + tokensOut * 540) / 1_000_000
                    : isSonnet ? (tokensIn * 21.6 + tokensOut * 108) / 1_000_000
                    : isClaude ? (tokensIn * 3.6 + tokensOut * 18) / 1_000_000
                    : 0);
              const payload = JSON.stringify({
                agent: agentName,
                tokensIn,
                tokensOut,
                cost,
                model,
              });
              try {
                const apiPort = parseInt(process.env.PORT || '3000', 10);
                const req = http.request({ hostname: '127.0.0.1', port: apiPort, path: '/api/system/token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res: any) => res.resume());
                req.on('error', () => {});
                req.write(payload);
                req.end();
              } catch {}
            }
          }
        }

        // ── Final save: persist final state ──
        clearTimeout(timeout);
        savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId });
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        clearActivity(agentName);
        untrackQuery(abortController);

      } catch (err: any) {
        clearActivity(agentName);
        untrackQuery(abortController);
        // Save partial history before error — prevents message loss on crash
        if (hasContent || sessionId) {
          try { savePartialState(agentName, { userMessage, fullReply, allEvents, sessionId }); } catch {}
        }
        ctrl.enqueue({ type: 'error', content: err.message || String(err), timestamp: ts() });
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
      }
      ctrl.close();
    },
  });
}

export async function chatOnce(agentName: string, userMessage: string, groupName?: string): Promise<{ reply: string; events: ChatEvent[] }> {
  const stream = createChatStream(agentName, userMessage, groupName);
  const reader = stream.getReader();
  let reply = '';
  const events: ChatEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
    if (value.type === 'text') reply += value.content || '';
    if (value.type === 'done') break;
  }
  return { reply, events };
}

function quickError(msg: string): ReadableStream<ChatEvent> {
  const ts = new Date().toISOString();
  return new ReadableStream({
    start(c) { c.enqueue({ type: 'error', content: msg, timestamp: ts }); c.enqueue({ type: 'done', content: '', timestamp: ts }); c.close(); },
  });
}
