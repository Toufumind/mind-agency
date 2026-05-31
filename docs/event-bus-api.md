# Unified Event Bus — API v0.2

> 开发契约定稿 | 17 事件 + Pub/Sub API + scope 隔离 + 5 错误码  
> 架构：复用 `:3001` WebSocket + HTTP，不新增端口

---

## 1. 概述

Event Bus 是 Mind Agency v0.6.0 的统一事件中枢。所有模块（Dashboard、Collab Board、Workflow）通过同一套 Pub/Sub API 消费和发布事件。

| 角色 | 消费方式 |
|------|----------|
| 前端（浏览器） | WebSocket `ws://localhost:3001`，发送 `subscribe`/`unsubscribe` 帧 |
| 后端（MCP / API Routes） | HTTP POST `http://localhost:3001/events`，`http://localhost:3001/broadcast` |
| 监控 | GET `http://localhost:3001/events/stats` |

---

## 2. 事件类型 (EventType)

**17 个事件**，枚举定义在 `src/types/index.ts` 和 `src/lib/event-bus.ts`。

### 2.1 Agent 生命周期

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 1 | `agent.status.changed` | `{ agent: string, status: "idle"\|"busy"\|"error"\|"offline", taskId?: string, since: number }` | Dashboard 在线卡片数据源 |
| 2 | `agent.error` | `{ agent: string, code: string, message: string, stack?: string }` | Agent 异常详情 |

### 2.2 任务流转

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 3 | `task.created` | `{ taskId: string, title: string, createdBy: string, priority?: "low"\|"medium"\|"high" }` | 新任务入库 |
| 4 | `task.assigned` | `{ taskId: string, from: string, to: string, title: string }` | 工作分配 / Agent 加入群组 |
| 5 | `task.in_progress` | `{ taskId: string, agent: string, since: number }` | 开始执行 |
| 6 | `task.completed` | `{ taskId: string, by: string, artefacts?: string[], duration: number }` | 完成并解除阻塞 |
| 7 | `task.blocked` | `{ taskId: string, blockedAgent: string, blockedBy: string, reason: string, since: number }` | Collab Board Blockage Map |
| 8 | `task.review_requested` | `{ taskId: string, reviewer: string, author: string }` | 请求 review |
| 9 | `task.review_completed` | `{ taskId: string, reviewer: string, author: string, verdict: "approved"\|"changes_requested" }` | Review 完成 |

### 2.3 消息

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 10 | `message.sent` | `{ sender: string, group: string, mentions: string[], length: number }` | `length` 单位 UTF-16 字符数，热力图权重 |
| 11 | `message.mention` | `{ sender: string, group: string, mentioned: string[] }` | @提及触发通知 |

### 2.4 轮询 & 健康

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 12 | `poll.result` | `{ agent: string, duration: number, triggered: number, polled: number }` | Token 趋势数据源 |
| 13 | `poll.error` | `{ agent: string, error: string, attempt: number }` | 告警自动化 |

### 2.5 WebSocket

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 14 | `ws.connect` | `{ clientId: string, agent?: string, since: number }` | 客户端连接，source=`"system"` |
| 15 | `ws.disconnect` | `{ clientId: string, code: number, reason: string, since: number }` | 客户端断开，source=`"system"` |

### 2.6 邮件

| # | EventType | payload | 说明 |
|---|-----------|---------|------|
| 16 | `email.received` | `{ from: string, to: string, subject: string, messageId: string }` | 收件 |
| 17 | `email.sent` | `{ from: string, to: string[], subject: string, messageId: string }` | 发件 |

---

## 3. 消息格式

所有事件通过同一个信封 `EventMessage` 传递：

```typescript
interface EventMessage {
  event: EventType;               // 17 个枚举值之一
  payload: Record<string, unknown>; // 见上表各类型
  timestamp: number;              // Unix ms，发生时戳
  source: string;                 // Agent 名 | "system"
  id: string;                     // UUID v4，幂等去重
}
```

---

## 4. Pub/Sub API

### 4.1 前端 (WebSocket)

客户端连接 `ws://localhost:3001`，收发 JSON 帧。

#### subscribe

```json
→ { "type": "subscribe", "filter": { ... }, "options": { ... } }
← { "type": "subscribed", "subId": "uuid", "scope": "events" }
← { "type": "event", "event": "message.sent", "payload": {...}, ... }
← { "type": "error", "code": "E_INVALID_FILTER", "message": "..." }
```

```typescript
subscribe(
  filter?: {
    event?: EventType | EventType[];  // AND: 事件类型过滤
    agent?: string;                   // AND: 来源 Agent
    taskId?: string;                  // AND: 任务 ID
  },
  options?: {
    scope?: "events" | "messages" | "all";  // 默认 "events"
    replay?: boolean;                        // MVP 预留
    since?: number;                          // MVP 预留，Unix ms
  }
): string  // 返回 subId
```

**过滤语义：**
- `filter` 内部字段 AND 关系，`filter.event` 数组 OR 关系
- `filter` 为空 → 订阅所有事件
- `scope: "events"` → 只收 EventBus 事件，不收 `/broadcast` 群聊消息
- `scope: "all"` → 事件 + 群聊都收（兼容旧行为）

#### unsubscribe

```json
→ { "type": "unsubscribe", "subId": "uuid" }
← { "type": "unsubscribed", "subId": "uuid" }
← { "type": "error", "code": "E_SUB_NOT_FOUND", "message": "..." }
```

#### ping/pong (keepalive)

```json
→ { "type": "ping" }
← { "type": "pong", "timestamp": 1717200000000 }
```

### 4.2 后端 (HTTP POST)

#### POST /events

发布事件到 Event Bus。

```bash
curl -X POST http://localhost:3001/events \
  -H "Content-Type: application/json" \
  -d '{
    "event": "task.completed",
    "payload": { "taskId": "abc", "by": "bob", "duration": 3600 },
    "source": "bob"
  }'
```

响应：

| 状态 | body | 条件 |
|------|------|------|
| 200 | `{"ok":true}` | 成功（含无匹配订阅者） |
| 400 | `{"ok":false,"error":"E_INVALID_FILTER: ..."}` | 非法 EventType（dev 环境） |
| 500 | `{"ok":false,"error":"..."}` | 内部异常 |

#### POST /broadcast (Legacy)

群聊广播，详见 `server.ts`。只推送给 scope=`"messages"` 或 `"all"` 的客户端。

#### GET /events/stats

```json
{
  "subscriptions": 5,
  "clients": 2,
  "dedupSize": 142,
  "clients": [...]
}
```

---

## 5. 错误码 (EventBusError)

```typescript
enum EventBusError {
  E_DUPLICATE_SUB   = "E_DUPLICATE_SUB",   // 重复订阅同一 filter+scope
  E_INVALID_FILTER  = "E_INVALID_FILTER",   // filter.event 包含非法 EventType
  E_SUB_NOT_FOUND   = "E_SUB_NOT_FOUND",    // unsubscribe 时 subId 不存在
  E_EMIT_FAILED     = "E_EMIT_FAILED",      // emit 时无活跃连接可推送
  E_BACKPRESSURE    = "E_BACKPRESSURE",     // 订阅者积压 > 1000，已断开
}
```

| 错误码 | 触发条件 | 调用方行为 |
|--------|----------|-----------|
| `E_DUPLICATE_SUB` | 同一客户端重复订阅 | 返回已有 subId / 忽略 |
| `E_INVALID_FILTER` | EventType 不在枚举中 | dev: throw; prod: console.error + counter |
| `E_SUB_NOT_FOUND` | unsubscribe(不存在的 subId) | throw（非 WS 断开场景） |
| `E_EMIT_FAILED` | emit 时所有订阅都不可达 | best-effort，不抛异常 |
| `E_BACKPRESSURE` | 单订阅积压 > 1000 | 自动断开该 sub + 发送 agent.error |

---

## 6. 可靠性保证

| 能力 | 策略 | 状态 |
|------|------|------|
| 幂等去重 | `id` UUID，内存 Set 去重（窗口 10000 条） | ✅ v0.2 |
| 消息顺序 | 单连接内 FIFO 保证；跨连接不保证 | ✅ 文档注明 |
| 订阅泄漏防护 | WS 断开自动清理 + 5 分钟孤儿扫描 | ✅ v0.2 |
| 反压保护 | 单订阅积压 > 1000 → 自动断开 + agent.error | ✅ v0.2 |
| 断线重连 | 客户端重连后重新 subscribe | 🔜 Week 1 后半 |
| 历史重放 | `replay` / `since` 接口预留，MVP 不实现 | 🔜 v0.6.1 |

---

## 7. 消费端映射

| 模块 | 组件 | 订阅 | 状态 |
|------|------|------|------|
| Dashboard | 在线状态卡片 | `subscribe({ event: "agent.status.changed" })` | ✅ |
| Dashboard | 活动时间线 | `subscribe({}, { scope: "events" })` | ✅ |
| Dashboard | Token 趋势 | `subscribe({ event: "poll.result" })` | ✅ |
| Workflow | 流转触发 | `subscribe({ event: ["task.assigned", "task.completed"] })` | ✅ |
| Collab Board | Activity Feed | `subscribe({}, { scope: "events" })` | ✅ |
| Collab Board | Blockage Map | `subscribe({ event: ["task.blocked", "task.completed"] })` | ✅ |
| Collab Board | 热力图 | `subscribe({ event: ["message.sent", "task.review_completed"] })` | ✅ |

---

## 8. 代码位置

| 文件 | 内容 |
|------|------|
| `src/lib/event-bus.ts` | EventType/EventBusError 枚举 + EventBus 类 (emit/subscribe/unsubscribe) |
| `server.ts` | WS 服务器 :3001，/events /broadcast /events/stats 端点 |
| `src/lib/ws-broadcast.ts` | `emitEvent()` / `broadcastToClients()` 工具函数 |
| `src/types/index.ts` | EventBus 类型导出 |
| `mcp/group-server.ts` | group_send/join/leave → EventBus 事件发射 |
| `src/lib/scheduler.ts` | poll.result / poll.error 事件发射 |

## 9. 架构决策记录

| 决策 | 结论 | 日期 |
|------|------|------|
| 端口 | 复用 :3001 | 6/1 |
| 频道隔离 | `scope` 参数路由 (events/messages/all) | 6/1 |
| 持久化重放 | MVP 不做，接口预留 replay/since | 6/1 |
| 方法名 | `emit` (非 `publish`)，`subscribe(filter, options)` 非回调模式 | 6/1 |
| 错误处理 | `subscribe` 抛异常 (非 null)，`emit` dev throw / prod counter | 6/1 |
| 反压阈值 | 1000 条/订阅 | 6/1 |
| 去重窗口 | 10000 条 UUID | 6/1 |
