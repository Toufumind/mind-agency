<div align="center">

<img src="public/logo-static.png" width="128" alt="Mind Agency Logo" />

# Mind Agency

**From Agent to Agency**

一个 AI 做不了的事，一群 AI 可以。分工、协作、讨论、达成共识——就像人类团队一样。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.3.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)]()
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)]()

</div>

---

## Screenshots / 截图

<div align="center">
<img src="assets/dashboard.png" width="800" alt="Dashboard" />
<br/>
<em>Dashboard / 仪表盘</em>
</div>

<br/>

<div align="center">
<img src="assets/agent-chat.png" width="800" alt="Agent Chat" />
<br/>
<em>Agent Collaboration / Agent 协作</em>
</div>

<br/>

<div align="center">
<img src="assets/workflow.png" width="800" alt="Workflow DAG" />
<br/>
<em>Workflow Pipeline / 工作流流水线</em>
</div>

---

## Features / 功能

| Feature | 描述 |
|---------|------|
| **Multi-Agent Collaboration** | 多个 AI Agent 通过群聊、邮件、共识投票协同工作 |
| **DAG Workflow Engine** | YAML 定义流水线，支持条件分支、人工审批、重试回滚 |
| **MCP Tool Protocol** | Agent 通过 JSON-RPC 调用群组管理、通信、工作流等工具 |
| **Real-time EventBus** | WebSocket 推送，17 种事件类型，Outbox 持久化 |
| **Agent Memory** | 三层记忆系统（短期/长期/实体），SimHash 语义搜索 |
| **Consensus & Voting** | AND/OR/阈值投票，对抗性审查，行为画像 |
| **Windows Desktop** | Electron 打包，一键安装即用 |
| **Multi-Theme** | Notion、Minimal White、Warm Wood、Deep Space、Nord |

## Download / 下载

### 方式一：下载 exe（推荐）/ Download exe (Recommended)

从 [Releases](https://github.com/Toufumind/mind-agency/releases) 下载最新版安装包，双击运行。

Download the latest installer from [Releases](https://github.com/Toufumind/mind-agency/releases) and run it.

> ⚠️ **当前仅支持 Windows** / Currently Windows only. macOS and Linux support planned.

### 方式二：从源码构建 / Build from Source

```bash
git clone https://github.com/Toufumind/mind-agency.git
cd mind-agency
npm install
npm run build:exe
```

输出在 `dist-exe/` 目录 / Output in `dist-exe/` directory.

---

## Architecture / 架构

```
┌─────────────────────────────────────────────────┐
│            Mind Agency (Electron exe)            │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │      Next.js + Tailwind UI (:3000)       │   │
│  │  Dashboard │ Agents │ Groups │ Settings   │   │
│  └──────────────────────────────────────────┘   │
│                       │ SSE                      │
│  ┌──────────────────────────────────────────┐   │
│  │     server.ts :3001 (EventBus + DAG)      │   │
│  │     WorkflowEngine │ Scheduler            │   │
│  └──────────────────────────────────────────┘   │
│                       │ MCP JSON-RPC             │
│  ┌──────────────────────────────────────────┐   │
│  │        Claude Agent SDK (AI Backend)      │   │
│  │  ┌────────────────────────────────────┐  │   │
│  │  │   group-server.mjs (MCP Tools)     │  │   │
│  │  │   Groups │ Chat │ Workflow │ Vote   │  │   │
│  │  │   Memory │ Email │ Agent │ Audit    │  │   │
│  │  └────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Data: File-based (Agents/, Groups/, .audit/)    │
└─────────────────────────────────────────────────┘
```

## Quick Start / 快速开始

### Prerequisites / 前置要求

- Node.js >= 18
- Anthropic API Key (or DeepSeek compatible API)

### Development / 开发调试

```bash
npm run dev          # Next.js dev server on :3000
npm run dev:ws       # WebSocket server on :3001
npm run dev:all      # Both simultaneously
```

Open `http://localhost:3000` — first visit triggers setup wizard for API Key configuration.

### Agent Configuration / Agent 配置

`Agents/<name>/config.json`:

```json
{
  "autoRespondToEmail": true,
  "roles": ["coordinator"],
  "permissions": {
    "canCreateGroup": true,
    "canDeleteGroup": false,
    "canDeploy": false
  }
}
```

## Project Structure / 项目结构

```
mind-agency/
├── src/
│   ├── app/                # Next.js pages + API routes (27 endpoints)
│   ├── components/         # React UI components
│   └── lib/                # Core: chat, event-bus, memory, consensus, permissions
├── mcp/
│   ├── group-server.ts     # MCP JSON-RPC server
│   └── tools/              # Modular tool handlers (group, chat, workflow, memory...)
├── electron/               # Electron main process + preload
├── server.ts               # WebSocket + EventBus + WorkflowEngine (:3001)
├── scripts/                # Build scripts
├── Agents/                 # Default agents: Alice, Bob, Charlie
├── Groups/                 # Default group with workflow DAG
└── public/                 # Static assets
```

## Environment Variables / 环境变量

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | 3001 | WebSocket server port |
| `POLL_INTERVAL` | 30000 | Agent polling interval (ms) |
| `DAG_INTERVAL` | 5000 | Workflow check interval (ms) |

See `.env.example` for full list.

## License / 许可证

[Apache License 2.0](LICENSE) — Copyright 2025 Toufumind
