<div align="center">

<img src="public/logo-static.png" width="100" alt="Mind Agency Logo" />

# Mind Agency

### From Agent to Agency

一个 AI 做不了的事，一群 AI 可以。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.3.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)]()
[![GitHub stars](https://img.shields.io/github/stars/Toufumind/mind-agency)](https://github.com/Toufumind/mind-agency)

</div>

---

## 这是什么

Mind Agency 是一个本地运行的多 AI 协作平台。

你创建 Agent，给它们角色和性格。你把 Agent 拉进群组，定义工作流。然后点"运行"——Agent 们自动分工、协作、讨论，像一个真正的团队。

**不是 API wrapper，不是 prompt template。** 是一个完整的协作系统：Agent 之间通过群聊和邮件通信，通过投票做决策，通过记忆积累经验。每一步都有审计日志，崩溃了自动恢复。

<div align="center">
<img src="assets/dashboard.png" width="800" alt="Dashboard" />
</div>

---

## 它和 ChatGPT / Copilot 有什么不同

你用 ChatGPT 写代码，它很聪明。但它是一个人在干活——没人 review，没人 test，没人发现问题。直到出了事。

Mind Agency 给你一个团队：

- **Alice** 写代码，**Bob** 审查，**Charlie** 测试
- 有分歧？投票决定。需要你批准？自动暂停等你
- 上次踩过什么坑？Agent 记得。下次不会再犯
- 进程崩溃了？从断点恢复，不丢进度

```
你: @Alice 帮我写一个用户注册接口
Alice: 好的，我来写
Alice: @Bob 代码写好了，帮我 review 一下
Bob: 看了一下，有两个问题：1. 缺少输入校验 2. 密码没有加密
Alice: 改好了，你再看看
Bob: ✅ 没问题了
Alice: @Charlie 帮我跑一下测试
Charlie: 测试全部通过 ✅
```

---

## 核心能力

### 🧠 文件系统即状态

不用数据库。群组是目录，聊天是 Markdown 文件，共识请求是 JSON，邮件也是 Markdown。每个消息一个文件，原子写入（tmp + rename）。

这意味着：
- 所有数据可以用文本编辑器直接查看和编辑
- Git 可以追踪所有变更
- 崩溃后文件不会损坏
- 你永远知道数据在哪里

### 🗳️ 共识投票 + 对抗性审查

不是"A 说好就好"。Mind Agency 有三种投票模式：
- **AND** — 所有人同意才通过
- **OR** — 任意 N 人同意即通过
- **Threshold** — 达到阈值即通过

关键决策还可以触发**对抗性审查**：第二 Agent 独立复核，可以否决。否决后进入结构化辩论，最多 3 轮。谁也说服不了谁？你来拍板。

### 🔄 工作流引擎

YAML 定义流水线，支持：
- **依赖编排** — A 做完 B 才能开始
- **条件分支** — 根据上一步输出动态路由
- **人工审批** — 关键步骤暂停等你批准
- **崩溃恢复** — 从检查点重启，不丢进度
- **热重载** — 执行中修改 YAML，引擎自动发现变化
- **补偿回滚** — 失败时自动执行补偿步骤

### 📡 信号驱动的自主性

Agent 不是被轮询的。系统扫描文件系统的变化（邮件、@mention、邀请），构建"信号"告诉 Agent："你有 3 封新邮件、2 个 @mention"。Agent 自己决定怎么处理。

优先级防抖：关键信号 5 秒内不重复触发，普通信号 60 秒。

### 🔒 四层权限嵌套

```
MCP 工具调用 → 权限引擎 → 共识引擎 → 对抗性审查
```

每一层都可以拦截。Agent 的每个动作都经过权限检查，关键操作需要投票，投票通过后还可能被对抗性审查否决。

### 📋 完整审计日志

每个 Agent 的每个动作——写了什么文件、发了什么消息、做了什么决策——全部记录到 `.audit/` 目录。出了问题？回溯日志找到根因。

### 💾 可靠性工程

- **DLQ** — 失败事件自动重试，指数退避
- **Outbox** — 先持久化再投递，崩溃不丢事件
- **Checkpoint** — 工作流断点保存，崩溃后自动恢复
- **Backpressure** — 订阅者掉队 1000 个事件自动断开

这些不是花哨的功能，是让你敢在生产环境用的基础设施。

---

## Agent 配置

你可以创建任意数量的 Agent。每个 Agent 有独立的角色、性格、记忆和行为风格。

```json
// Agents/diana/config.json
{
  "roles": ["frontend", "react", "ui"],
  "autoRespondToEmail": true,
  "permissions": { "canCreateGroup": true }
}
```

每个 Agent 的性格由 `CLAUDE.md` 文件定义——你写什么，它就是什么样的 Agent。

系统自带三个示例 Agent（开箱即用）：
- **Alice** — 协调者，代码编写和决策
- **Bob** — 分析师，代码审查和质量把关
- **Charlie** — 执行者，测试和运维

你也可以创建更多：前端专家、安全审计、文档工程师……数量没有上限。

---

## 快速开始

### 下载安装（推荐）

从 [Releases](https://github.com/Toufumind/mind-agency/releases) 下载 `Mind-Agency-Setup-0.3.0.exe`，双击运行。

> ⚠️ 当前仅支持 Windows。macOS / Linux 在路线图中。

### 从源码运行

```bash
git clone https://github.com/Toufumind/mind-agency.git
cd mind-agency
npm install
npm run dev
```

打开 `http://localhost:3000`，首次访问会引导你配置 API Key。

### 3 分钟上手

1. **配置 API Key** — 设置页面填入你的 AI 模型 Key
2. **创建 Agent** — 给每个 Agent 起名字、设角色、写性格描述
3. **建立群组** — 把 Agent 拉进群组，定义工作流
4. **开始协作** — 给 Agent 分配任务，看它们自动协作

### 需要什么

- 一个 AI 模型的 API Key（[Claude](https://console.anthropic.com/) / [DeepSeek](https://platform.deepseek.com/) / [GPT-4o](https://platform.openai.com/)）
- DeepSeek 价格最低，几毛钱一天

---

## 和同类产品有什么不同

| | Mind Agency | CrewAI / AutoGen | 直接用 ChatGPT |
|---|:---:|:---:|:---:|
| 多个 AI 协作 | ✅ | ✅ | ❌ |
| 可视化界面 | ✅ | ❌ | ❌ |
| 共识投票 + 对抗性审查 | ✅ | ❌ | ❌ |
| 人工审批节点 | ✅ | ❌ | ❌ |
| 崩溃自动恢复 | ✅ | ❌ | ❌ |
| 审计日志 | ✅ | ❌ | ❌ |
| 本地运行，数据在你手里 | ✅ | ✅ | ❌ |
| 一键安装 exe | ✅ | ❌ | N/A |

---

## 技术架构

```
Mind Agency (Electron 桌面应用)
├── 前端 — Next.js + Tailwind CSS (:3000)
│   Dashboard / Agent 管理 / 群组 / 工作流 / 设置
├── 后端 — Node.js WebSocket (:3001)
│   EventBus (17 事件类型 + DLQ + Outbox)
│   WorkflowEngine (DAG + 热重载 + 断点恢复)
├── AI 层 — Claude Agent SDK
│   MCP 工具服务器 (48 个工具)
│   权限引擎 + 共识引擎
└── 数据 — 本地文件系统
    Agents/  Groups/  .audit/  .mind/
```

---

## 项目结构

```
mind-agency/
├── src/
│   ├── app/              # Next.js 页面 + 27 个 API 路由
│   ├── components/       # React 组件
│   └── lib/              # 核心库
│       ├── event-bus.ts  # EventBus + WorkflowEngine (1200 行)
│       ├── consensus.ts  # 共识引擎 (AND/OR/阈值 + 对抗性审查)
│       ├── chat.ts       # AI 集成 (Claude/DeepSeek/Codex)
│       ├── memory.ts     # 三层记忆系统
│       ├── auto-respond.ts # 信号驱动自主响应
│       └── ...
├── mcp/                  # MCP 工具服务器
│   ├── group-server.ts   # JSON-RPC 入口
│   └── tools/            # 7 个模块化工具文件
├── electron/             # Electron 主进程
├── server.ts             # WebSocket + EventBus + Workflow (:3001)
├── Agents/               # Agent 配置和数据
├── Groups/               # 群组配置和工作流
└── public/               # 静态资源
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WS_PORT` | 3001 | WebSocket 端口 |
| `POLL_INTERVAL` | 30000 | Agent 轮询间隔 (ms) |
| `DAG_INTERVAL` | 5000 | 工作流检查间隔 (ms) |

详见 `.env.example`。

---

## License

[Apache License 2.0](LICENSE) — Copyright 2025 Toufumind
