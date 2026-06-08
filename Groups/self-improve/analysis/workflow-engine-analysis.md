# 🔧 工作流引擎架构深度分析报告

> **分析者**: Alice | **日期**: 2025-06-08 | **版本**: v0.5/v0.6

---

## 一、系统架构全貌

### 核心模块关系

```
┌──────────────────────────────────────────────────────────────────┐
│                        server.ts (入口)                          │
│  WebSocket + HTTP API + EventBus + WorkflowEngine 单例           │
└─────────┬──────────────┬──────────────────┬──────────────────────┘
          │              │                  │
    ┌─────▼─────┐  ┌────▼────┐   ┌────────▼────────┐
    │ EventBus   │  │ Workflow │   │   Scheduler     │
    │ v0.3       │  │ Engine   │   │ v0.7            │
    │ DLQ+outbox │  │ DAG+CB   │   │ 事件驱动+轮询   │
    └─────┬─────┘  └────┬────┘   └────────┬────────┘
          │              │                  │
    ┌─────▼──────┐  ┌───▼────────┐  ┌──────▼──────┐
    │ Signal     │  │ Task Queue │  │ Watcher     │
    │ Collector  │  │ per-agent  │  │ fs.watch    │
    └────────────┘  └────────────┘  └─────────────┘
          │              │                  │
    ┌─────▼──────────────▼──────────────────▼────────┐
    │         ChatStepExecutor (真实 AI 执行)          │
    │   chatOnce / createChatStream + 模型 fallback   │
    └────────────────────────────────────────────────┘
```

### 已有群组工作流

| 群组 | 工作流名称 | 步骤数 | 特性 |
|------|-----------|--------|------|
| dev-team | dev-ops-pipeline | 6 | 线性串行 plan→design→implement→test→review→deploy |
| deploy-pipeline | deploy-pipeline | 10 | 3个触发器 + routes分支 + reviewer + fix补偿 |
| self-improve | self-improve-default | 0 | 空工作流 |

---

## 二、当前执行效率分析

### ✅ 已有优势（值得保留）

| 能力 | 实现位置 | 评估 |
|------|---------|------|
| **DAG 依赖解析** | `WorkflowEngine.executeDag()` | ✅ 支持 dependsOn 数组，自动拓扑排序 |
| **回调模型 (Callback)** | `notifyAgent()` + `callback()` | ✅ 异步fire-and-forget，不阻塞引擎 |
| **循环依赖检测** | `parseWorkflowYaml()` DFS | ✅ 启动时阻断，运行时 `detectCycle()` |
| **超时检测** | `tick()` 轮询 | ✅ WAITING 状态超时自动重试/失败 |
| **审查分支** | `evaluatePostStep()` | ✅ reviewer 注入 + REJECTED→retry/fail |
| **Checkpoint 持久化** | `workflow-checkpoint.ts` | ✅ 崩溃恢复，JSON文件无依赖 |
| **事件总线 DLQ** | `EventBus` | ✅ 指数退避重试 + 死信队列 |
| **Outbox 持久化** | `persistToOutbox()` | ✅ JSONL 原子追加，启动时 replay |
| **系统负载感知** | `getSystemLoad()` | ✅ CPU 过载时暂停调度 |
| **人类审批** | `human_approval` step | ✅ 暂停 DAG，等待 API 恢复 |
| **路由条件** | `evalRouteCondition()` | ✅ output contains/==/!= 匹配 |

### ⚠️ 执行效率瓶颈

#### 瓶颈 1: 调度循环依赖定时器

```
当前流程:
  schedule(runId) → 找 ready steps → execNode() → notifyAgent()
  → Agent 异步处理 → callback(runId, stepId, output) → schedule(runId)

问题: tick() 每10秒轮询一次超时和 BLOCKED 状态
     BLOCKED 步骤的重试依赖 tick() 而非事件驱动
```

**影响**: 最坏情况下 BLOCKED 步骤要等 10 秒才能被重试检测到。

#### 瓶颈 2: 串行回调处理

```typescript
// event-bus.ts line ~800
schedule(runId) {
  ready.sort((a, b) => (PRIORITY[a...] ?? 2) - (PRIORITY[b...] ?? 2));
  for (const node of ready) {
    this.execNode(runId, node, nodes);  // ← 虽然 execNode 是 async，但这里没 await
  }
}
```

**问题**: `execNode()` 是 async 但 `schedule()` 中用 `for...of` 没有 `await`，导致并行执行不可控。当多个步骤同时 ready 时，它们确实会并行执行（因为 notifyAgent 是 fire-and-forget），但如果某个步骤同步抛出异常，后续步骤可能不被执行。

#### 瓶颈 3: 回调轮询 Agent 文件系统

```typescript
// ChatStepExecutor.execute()
const reportDir = path.join(MIND_DIR, 'agents', agent, '.task-reports');
const reportPath = path.join(reportDir, `${step.id}.json`);
if (fs.existsSync(reportPath)) {  // ← 每次执行都要同步检查文件
```

**问题**: Agent 通过写文件 + 引擎轮询文件来传递结果，存在竞态条件（文件可能正在写入中）。

---

## 三、步骤依赖链瓶颈

### 依赖模型分析

```typescript
// DagNode
interface DagNode {
  step: WorkflowStep;
  deps: string[];        // 上游依赖（多个）
  dependents: string[];  // 下游被依赖（自动重建）
  status: StepStatus;
  routes?: WorkflowStepRoute[];  // 条件路由
}
```

### 核心瓶颈

#### 🔴 瓶颈 A: 条件分支仅支持字符串匹配

```typescript
evalRouteCondition(when: string, output: string): boolean {
  // 只支持: output contains X, output == X, output != X
  // 不支持: $.step.field > 100, 组合条件, 正则
}
```

**局限性**: 只能根据步骤输出的文本内容做路由，无法进行数值比较、字段提取、多条件组合。

#### 🔴 瓶颈 B: 无 Fan-in/Fan-out 聚合

```yaml
# 当前: 线性依赖
steps:
  - id: build
    dependsOn: [test]     # 只能等一个前置
  - id: deploy
    dependsOn: [build]    # 只能等一个前置

# 无法表达: 3个专家同时评审 → 2/3通过即可
# 无法表达: 1个步骤触发3个并行子任务 → 等全部完成
```

**影响**: 复杂的并行+聚合场景（如投票、多数通过）需要手写 workaround。

#### 🟡 瓶颈 C: 动态修改步骤写文件有竞态

```typescript
addStep(group: string, step: WorkflowStep): boolean {
  const raw = fs.readFileSync(wfPath, 'utf-8');
  const def = parseWorkflowYaml(raw);
  def.steps.push(step);
  atomicWrite(wfPath, yaml.dump(def));  // ← 可能与其他修改冲突
  return true;
}
```

**问题**: 没有文件锁，多个并发修改可能互相覆盖。`atomicWrite` 只保证单次写入原子性，不保证 read-modify-write 的原子性。

#### 🟡 瓶颈 D: 审查注入不支持配置化

```typescript
// 自动注入 review 步骤
if (node.step.reviewer) {
  const reviewId = `${sid}_review`;
  // ... 创建 review 步骤，添加到 nodes map
}
```

**问题**: 审查步骤的创建逻辑硬编码在引擎中，无法配置审查策略（如多人并行审查、审查者轮询、审查超时降级）。

---

## 四、现有复杂业务场景支持度

| 场景 | 当前支持度 | 缺失能力 |
|------|-----------|---------|
| **线性流水线** | ✅ 完全支持 | - |
| **条件分支 (if/else)** | ✅ 基本支持 | 仅字符串匹配，无表达式引擎 |
| **审查+重试** | ✅ 支持 | reviewer 注入 + maxRejectRetries |
| **人类审批** | ✅ 支持 | human_approval 暂停 DAG |
| **多触发器** | ✅ 支持 | schedule + file_change + event + manual |
| **崩溃恢复** | ✅ 支持 | JSON checkpoint 持久化 |
| **投票/多数通过** | ❌ 不支持 | 无聚合节点 |
| **超时降级** | 🟡 部分 | 只有超时→重试/失败，无 onTimeout fallback_agent |
| **补偿事务 (Saga)** | 🟡 部分 | 有 onFailure 指向补偿步骤，但非自动补偿链 |
| **子流程嵌套** | ❌ 不支持 | 无法在步骤中调用另一个 workflow |
| **并行 fan-out + fan-in** | ❌ 不支持 | 无 parallel + aggregate 语法 |
| **步骤级超时配置** | ✅ 支持 | timeout 字段（默认 300s） |
| **优先级调度** | ✅ 支持 | critical > high > normal > low |
| **模型 fallback** | ✅ 支持 | ChatStepExecutor 多模型降级 |

---

## 五、具体架构改进建议

### 建议 1: 引入 DAG 并行执行池（短期 - 优先级 P0）

**问题**: `schedule()` 中 `execNode()` 并发不可控

**改进**:

```typescript
// event-bus.ts - schedule() 改进
private async schedule(runId: string): Promise<void> {
  const ready = this.findReadySteps(runId);
  
  // 使用 Promise.allSettled 控制并发
  const concurrency = this.getGlobalConcurrency();
  const batches = chunkArray(ready, concurrency);
  
  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(node => this.execNode(runId, node, nodes))
    );
    
    // 处理失败的步骤
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.error(`[wf] Step ${batch[i].step.id} failed:`, result.reason);
      }
    }
  }
}
```

### 建议 2: 条件表达式引擎（中期 - 优先级 P1）

**问题**: `evalRouteCondition()` 和 `evalCond()` 只支持简单字符串匹配

**改进**: 引入轻量级表达式求值器

```typescript
// 新增: src/lib/expr-eval.ts
class ExprEvaluator {
  evaluate(expr: string, context: Record<string, any>): boolean | any {
    // 支持:
    // $.step.output contains "APPROVED"
    // $.step.field > 100
    // and_($.a.output contains X, $.b.output == Y)
    // $.step.output matches /regex/
    // ternary($.a.output contains OK, "deploy", "rollback")
  }
}

// YAML 语法扩展
routes:
  - step: deploy
    when: '$.review.output contains "APPROVED" and $.test.score > 80'
  - step: rollback
    when: '$.review.output contains "REJECTED" or $.test.score < 60'
```

### 建议 3: Fan-in/Fan-out 聚合节点（中期 - 优先级 P1）

**问题**: 无法表达并行+聚合场景

**改进**:

```yaml
# YAML 语法扩展
steps:
  - id: parallel_review
    type: fan-out
    steps:
      - agent: Expert1
        action: review
        prompt: "审查安全性"
      - agent: Expert2
        action: review
        prompt: "审查性能"
      - agent: Expert3
        action: review
        prompt: "审查架构"
    aggregate:
      policy: majority     # majority | all | any | threshold
      threshold: 0.67      # 67% 通过
    dependsOn: [design]

  - id: proceed
    type: fan-in
    dependsOn: [parallel_review]
    condition: '$.parallel_review.result == "APPROVED"'
```

**实现**:

```typescript
// WorkflowEngine 中新增
private async executeFanOut(runId: string, node: DagNode, nodes: Map<string, DagNode>): Promise<void> {
  const fanSteps = node.step.steps || []; // 子步骤列表
  const results = await Promise.allSettled(
    fanSteps.map(s => this.executeStep(runId, s, node))
  );
  
  // 聚合
  const policy = node.step.aggregate?.policy || 'all';
  const passed = results.filter(r => r.status === 'fulfilled').length;
  const total = results.length;
  
  let aggregated: boolean;
  switch (policy) {
    case 'all': aggregated = passed === total; break;
    case 'any': aggregated = passed > 0; break;
    case 'majority': aggregated = passed / total >= (node.step.aggregate?.threshold || 0.5); break;
    default: aggregated = passed === total;
  }
  
  node.output = JSON.stringify({ result: aggregated ? 'APPROVED' : 'REJECTED', passed, total });
  node.status = StepStatus.COMPLETED;
}
```

### 建议 4: 超时降级 + Fallback Agent（短期 - 优先级 P0）

**问题**: 超时只能重试或失败，无法自动转交

**改进**:

```yaml
steps:
  - id: boss_approval
    agent: CEO
    action: human_approval
    timeout: 1800
    onTimeout:
      action: assign_fallback
      fallback_agent: COO
      fallback_prompt: "CEO 超时未审批，转交处理"
```

**实现**:

```typescript
// tick() 中的超时处理增强
if (elapsed > timeout) {
  const onTimeout = node.step.onTimeout;
  if (onTimeout?.fallback_agent) {
    // 转交给 fallback agent
    node.step.agent = onTimeout.fallback_agent;
    if (onTimeout.fallback_prompt) {
      node.step.prompt = onTimeout.fallback_prompt;
    }
    node.status = StepStatus.PENDING;
    node.notifiedAt = 0;
    this.schedule(runId);
  } else if (node.retryCount < node.maxRetries) {
    // 原有重试逻辑
  }
}
```

### 建议 5: 事件驱动替代轮询（中期 - 优先级 P2）

**问题**: BLOCKED 步骤的重试检测依赖 10s tick 轮询

**改进**:

```typescript
// 当下游步骤完成时，主动检查上游 BLOCKED 步骤
callback(runId, stepId, output) {
  // ... 现有逻辑
  
  // 新增: 检查下游 BLOCKED 步骤是否可以解除阻塞
  const nodes = this.runNodes.get(runId);
  for (const [id, node] of nodes) {
    if (node.status === StepStatus.BLOCKED) {
      const depsOk = node.deps.every(depId => {
        const dn = nodes.get(depId);
        return dn?.status === StepStatus.COMPLETED || dn?.status === StepStatus.SKIPPED;
      });
      if (depsOk) {
        node.status = StepStatus.PENDING;
        console.log(`[wf] ${id} unblocked by ${stepId} completion`);
      }
    }
  }
  
  this.schedule(runId);
}
```

### 建议 6: 补偿事务 Saga 模式（长期 - 优先级 P3）

```yaml
steps:
  - id: create_order
    action: create
    compensation:
      stepId: cancel_order
      on: [FAILED, TIMEOUT]
  - id: charge_payment
    action: charge
    dependsOn: [create_order]
    compensation:
      stepId: refund_payment
      on: [FAILED]
  - id: send_notification
    action: notify
    dependsOn: [charge_payment]

# 当 charge_payment 失败时:
# 1. 自动触发 refund_payment（如果 charge 已部分完成）
# 2. 自动触发 cancel_order（回滚订单）
```

### 建议 7: 工作流版本管理 + 热更新（长期 - 优先级 P3）

```typescript
// 当前: 动态修改直接改 YAML 文件
// 问题: 没有版本历史，没有 diff，没有回滚

// 改进: 引入版本管理
interface WorkflowVersion {
  version: number;
  yaml: string;
  changedBy: string;
  changedAt: number;
  changeLog: string;
}

// 存储: Groups/<group>/.workflow-versions/
// 热更新: 检测 YAML 变更 → 解析新版本 → 与运行中 DAG 合并
```

---

## 六、优先级路线图

```
Phase 1 — 短期 (1-2周) 🔧
├── ✅ P0: schedule() 并发控制 + Promise.allSettled
├── ✅ P0: 超时降级 fallback_agent
├── ✅ P0: callback() 后主动解除下游 BLOCKED
└── ✅ P0: 动态步骤修改加文件锁

Phase 2 — 中期 (2-4周) 🔧
├── 🔧 P1: 条件表达式引擎 (evalRouteCondition 增强)
├── 🔧 P1: Fan-out/Fan-in 聚合节点
├── 🔧 P2: tick() 轮询改事件驱动
└── 🔧 P2: 审查策略配置化 (多人审查/轮询/超时降级)

Phase 3 — 长期 (1-2月) 🚀
├── 🚀 P3: Saga 补偿事务自动链
├── 🚀 P3: 子流程嵌套 (workflow 可调用 workflow)
├── 🚀 P3: 工作流版本管理 + 热更新
└── 🚀 P3: 工作流可视化 Gantt 图增强
```

---

## 七、总结

> **核心结论**: 当前工作流引擎已具备生产级的 DAG 执行、检查点恢复、审查分支和事件总线能力。主要改进方向是：
>
> 1. **可靠性** — 并发控制、文件锁、超时降级
> 2. **表达力** — 条件引擎、fan-in/fan-out、子流程
> 3. **实时性** — 事件驱动替代轮询
> 4. **事务性** — Saga 补偿、版本管理

建议与 Bob（系统架构师）讨论可行性，与 Charlie（技术负责人）确认优先级排期。
