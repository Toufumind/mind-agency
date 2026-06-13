# Spec: Mind Agency Architecture Refactoring

## Objective

全面重构 Mind Agency 的代码架构，解决当前存在的稳定性、可维护性和质量问题。目标是让项目从"能跑就行"升级到"工程化可维护"。

### 目标用户
开发者/团队，用于 AI Agent 编排和协作

### 成功标准
- EXE 打包稳定，开箱即用（logo 显示、默认 agent/group 存在、无白屏）
- 代码无重复逻辑（系统提示、WebSocket 重连、proxy 模式）
- i18n 完整覆盖所有 UI 字符串
- 空 catch 块全部替换为日志
- 构建系统统一（不再有两套打包方案）
- 主题 CSS 不再重复 600 行

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, TypeScript
- **Backend:** Node.js, WebSocket (server.ts :3001), MCP JSON-RPC
- **Desktop:** Electron 42, electron-packager
- **AI:** Claude / DeepSeek / GPT-4o via API
- **RAG:** LanceDB + BGE-small-zh (local embedding)
- **Testing:** Vitest v4, V8 coverage
- **Deployment:** Cloudflare Pages (landing), GitHub Releases (exe)

## Commands

```bash
npm run dev          # Next.js dev server (:3000)
npm run dev:ws       # WebSocket server (:3001)
npm run dev:all      # Both simultaneously
npm run build        # Production build
npm run build:exe    # Electron packaging (electron-packager)
npx tsc --noEmit     # Type check
npx vitest run       # Run tests
npx vitest run --coverage  # Run tests with coverage
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/                # REST API endpoints
│   ├── groups/[name]/      # Group detail page
│   ├── agents/[name]/      # Agent detail page
│   └── ...
├── lib/                    # Server-side business logic (78 files, ~16.5k lines)
│   ├── agent-identity.ts   # Agent identity building (canonical source)
│   ├── agent-proxy.ts      # Agent state machine
│   ├── chat.ts             # AI integration + session management
│   ├── data-dir.ts         # Centralized path config
│   ├── event-bus.ts        # EventBus + WorkflowEngine
│   ├── providers/          # AI provider implementations
│   └── ...
├── components/             # React UI components (20 files, ~5.1k lines)
│   ├── workflow-arch.tsx   # NLP paper style architecture diagram
│   ├── sidebar-context.tsx # Shared polling + WebSocket
│   ├── chat-panel.tsx      # Chat UI
│   └── ...
electron/
├── main.cjs               # Electron entry point
├── preload.cjs            # Context bridge
mcp/
├── tools/                 # MCP tool definitions
├── group-server.ts        # MCP JSON-RPC server
tests/
├── *.test.ts              # Unit tests (50+ files)
scripts/
├── build-exe.mjs          # Electron packaging
landing/                   # Static landing page (Cloudflare Pages)
```

## Code Style

```typescript
// 1. Always use 'use client' for interactive components
'use client';

// 2. Use cn() for conditional classNames
import { cn } from '@/lib/utils';
<div className={cn('base-class', isActive && 'active', className)} />

// 3. Use theme system via CSS variables (no raw hex in components)
const filter = THEME_FILTERS[theme] || 'none';

// 4. Use useT() hook for i18n (never hardcode Chinese)
const { t } = useT();
<p data-i18n="key">{t('key')}</p>

// 5. Prefer inline SVG over <img src> for assets (EXE compatibility)
// BAD:  <img src="/logo.svg" />
// GOOD: <svg viewBox="0 0 32 32">...</svg>

// 6. Always log errors (never empty catch)
// BAD:  try { ... } catch {}
// GOOD: try { ... } catch (e) { console.error('[context]', e); }

// 7. Use centralized URL config (never hardcode 127.0.0.1)
import { getApiBase, getWsBase } from '@/lib/data-dir';
fetch(`${getApiBase()}/api/endpoint`);
```

## Testing Strategy

- **Framework:** Vitest v4 with V8 coverage
- **Unit tests:** `tests/*.test.ts` — cover lib/ modules
- **Component tests:** (missing, to be added) `tests/*.test.tsx`
- **API tests:** (missing, to be added) `tests/api/*.test.ts`
- **Coverage target:** 80%+ for src/lib/
- **Run before commit:** `npx vitest run`

## Refactoring Tasks

### Phase 1: Critical Fixes (EXE 稳定性)

- [ ] **T1: Centralized URL config**
  - Replace all 15+ hardcoded `127.0.0.1:3000/3001` with `getApiBase()`/`getWsBase()` from `data-dir.ts`
  - Files: `data-dir.ts`, `chat.ts`, `relay.ts`, `agent-proxy.ts`, `agent-identity.ts`, `ws-embedded.ts`, `page.tsx`, `economy/page.tsx`, `agents/[name]/page.tsx`, `orchestrate/route.ts`, `system/pending/route.ts`
  - Acceptance: `grep -r "127.0.0.1" src/` returns 0 matches
  - Verify: `npx tsc --noEmit && npx vitest run`

- [ ] **T2: Deduplicate system prompt**
  - Remove duplicated L1/L2/L3 boundary block from `chat.ts` (lines 260-281) and `agent-identity.ts` (lines 75-96)
  - Keep canonical copy in `agent-identity.ts`, have `chat.ts` import from there
  - Files: `chat.ts`, `agent-identity.ts`
  - Acceptance: No duplicated prompt strings across files
  - Verify: `npx vitest run -- --grep "identity\|chat"`

- [ ] **T3: Clean stale test data**
  - Add `Agents/real-test-*` and `Agents/test-agent` to `.gitignore`
  - Remove 233 stale `real-test-*` directories from git tracking
  - Files: `.gitignore`, `Agents/` directory
  - Acceptance: `ls Agents/ | grep real-test` returns nothing
  - Verify: `git status` shows clean

- [ ] **T4: Fix EXE agent seeding**
  - Ensure `seedDataDir()` reads from `.next-server/Agents/` when asar lacks `Agents/`
  - Skip test directories during seeding
  - Files: `electron/main.cjs`
  - Acceptance: EXE shows Alice/Bob/Charlie on first launch
  - Verify: Run EXE, check sidebar shows agents

- [ ] **T5: Fix EXE logo**
  - Logo is now inline SVG (already fixed in previous commit)
  - Verify: Run EXE, logo displays in sidebar

### Phase 2: Code Quality (代码质量)

- [ ] **T6: Replace empty catch blocks**
  - Find all `catch {}` and `catch (e) {}` blocks
  - Replace with `console.error('[context]', e)` or logger calls
  - Files: ~20 files across `src/lib/` and `src/components/`
  - Acceptance: `grep -rn "catch {}" src/` returns 0 matches
  - Verify: `npx tsc --noEmit`

- [ ] **T7: Unify WebSocket reconnect**
  - Create `useWebSocket(url, onMessage, options)` hook
  - Replace 5+ duplicated reconnect patterns in: `chat-panel.tsx`, `email-client.tsx`, `notification-provider.tsx`, `sidebar-context.tsx`, `page.tsx`
  - Files: New `src/hooks/use-websocket.ts`, 5 consumer files
  - Acceptance: Single WebSocket implementation, all consumers use the hook
  - Verify: `npx tsc --noEmit`

- [ ] **T8: Complete i18n coverage**
  - Add ~100 missing translation keys to `i18n.tsx`
  - Replace all hardcoded Chinese strings with `t('key')` calls
  - Fix `<html lang="zh-CN">` to respect language setting
  - Files: `i18n.tsx`, `agents/[name]/page.tsx`, `page.tsx`, `learning/page.tsx`, `providers.tsx`, `chat.ts`, `loading.tsx`, `layout.tsx`
  - Acceptance: `grep -rn "'[一-龥]" src/app/ | wc -l` < 5 (only in i18n.tsx definitions)
  - Verify: Switch language in settings, all UI text updates

- [ ] **T9: Eliminate self-referential HTTP calls**
  - `chat.ts` line 787 and `relay.ts` line 328 call `http://127.0.0.1:3000/api/system/token` via HTTP
  - Replace with direct function import: `import { recordTokenUsage } from '@/lib/token-economy'`
  - Files: `chat.ts`, `relay.ts`, `token-economy.ts`
  - Acceptance: No HTTP calls to self in lib/
  - Verify: `npx vitest run`

### Phase 3: Architecture (架构优化)

- [ ] **T10: Consolidate proxy pattern**
  - Create `BaseProxy` class with common cache + disk I/O + singleton boilerplate
  - Refactor 7 proxy classes to extend it: `agent-proxy`, `audit-proxy`, `email-proxy`, `group-proxy`, `scoring-proxy`, `system-proxy`, `skill-proxy`
  - Files: New `src/lib/base-proxy.ts`, 7 proxy files
  - Acceptance: Each proxy < 150 lines (down from 300-600)
  - Verify: `npx vitest run`

- [ ] **T11: Externalize theme CSS**
  - Convert 600-line `globals.css` theme blocks into generated CSS
  - Create `scripts/gen-themes.mjs` that reads theme definitions from JS and outputs CSS
  - Files: `scripts/gen-themes.mjs`, `globals.css`, `package.json` (add `gen:themes` script)
  - Acceptance: `globals.css` < 100 lines, themes still work
  - Verify: Visual regression check (manual)

- [ ] **T12: Consolidate build system**
  - Remove `electron-builder` config from `package.json`
  - Keep only `@electron/packager` via `scripts/build-exe.mjs`
  - Remove `build-installer.bat`
  - Files: `package.json`, `scripts/build-exe.mjs`
  - Acceptance: Single build command works
  - Verify: `npm run build:exe`

- [ ] **T13: Fix process.env mutation**
  - Remove `process.env.ANTHROPIC_AUTH_TOKEN = s.apiKey` from `chat.ts`
  - Pass API config as function parameters instead of mutating globals
  - Files: `chat.ts`, `provider-profiles.ts`, `providers/*.ts`
  - Acceptance: No `process.env.ANTHROPIC_*` assignments
  - Verify: `npx vitest run`

- [ ] **T14: Standardize polling intervals**
  - Create `src/lib/config.ts` with centralized polling intervals
  - Replace all hardcoded `setInterval` values
  - Files: New `src/lib/config.ts`, `chat-panel.tsx`, `page.tsx`, `groups/[name]/page.tsx`, `sidebar-context.tsx`
  - Acceptance: All polling intervals defined in one place
  - Verify: `npx tsc --noEmit`

## Boundaries

- **Always:** Run `npx tsc --noEmit` before commit, follow naming conventions, use `cn()` for classNames, use `t()` for UI strings
- **Ask first:** Database schema changes, adding new dependencies, changing build config, modifying Electron main process
- **Never:** Commit `.env`/`.mind/`/`.audit/`, edit `node_modules/`, remove failing tests, hardcode `127.0.0.1`, use empty `catch {}`

## Success Criteria

1. ✅ EXE 开箱即用：logo 显示、默认 agent/group 存在、无白屏
2. ✅ 无重复代码：系统提示 1 份、WebSocket 重连 1 份、proxy 基类 1 份
3. ✅ i18n 完整：所有 UI 字符串通过 `t()` 翻译
4. ✅ 无空 catch：所有错误都被记录
5. ✅ 构建统一：只有一个打包方案
6. ✅ 主题 CSS < 100 行（当前 600 行）
7. ✅ 测试覆盖 80%+（当前缺失 component/API 测试）

## Open Questions

1. 是否需要添加 component 测试（React Testing Library）？
2. 是否需要添加 E2E 测试（Playwright）？
3. 主题系统是否需要支持用户自定义主题？
4. 是否需要将文件系统存储迁移到数据库？
