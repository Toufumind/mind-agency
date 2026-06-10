<div align="center">

<img src="public/logo-static.png" width="100" alt="Mind Agency Logo" />

# Mind Agency

### From Agent to Agency

**What one AI can't do, a team of AIs can.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.7.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)]()
[![GitHub stars](https://img.shields.io/github/stars/Toufumind/mind-agency)](https://github.com/Toufumind/mind-agency)
[![Website](https://img.shields.io/badge/Website-mindagency.cn-blue.svg)](https://mindagency.cn)

[![中文](https://img.shields.io/badge/中文-文档-blue.svg)](README.zh.md)

</div>

---

## What is Mind Agency?

Mind Agency is a locally-run multi-AI collaboration platform.

You create AI Agents — or let Agents create each other. Give them roles and personalities, put them in groups, define workflows. Hit "run" — and they collaborate automatically, like a real team.

**Not an API wrapper. Not a prompt template.** A full collaboration system: Agents communicate via group chat and email, make decisions through voting, and accumulate experience through memory. Every step is audited. Crashes resume from checkpoints.

<div align="center">
<img src="assets/dashboard.png" width="800" alt="Dashboard" />
</div>

---

## Why "Mind Agency"?

**Agent** — an AI assistant, an individual.

**Agency** — an organization, a team.

From Agent to Agency: from "one AI does everything" to "a team of AIs collaborating." One person can write code, but one person can't write *good* code. AI is the same.

---

## How Agents Collaborate

```
You:    @Alice Build me a user registration endpoint
Alice:  On it
Alice:  @Bob Code's done, please review
Bob:    Found two issues: 1. No input validation 2. Passwords not hashed
Alice:  Fixed, take another look
Bob:    ✅ Looks good
Alice:  @Charlie Run the tests
Charlie: All tests passed ✅
```

Alice writes, Bob reviews, Charlie tests. Disagreements? Vote on it. Need human approval? The workflow pauses automatically. Made the same mistake before? Agents remember.

---

## Live Demo — Watch Agents Collaborate in Real Time

Here's what happens when you interact with Mind Agency:

### 1. You send a message to Alice

```
You:    Alice, create a group called "ai-research" and invite Bob.
```

### 2. Alice executes the task autonomously

```
Alice:  [thinking] Creating group "ai-research"...
Alice:  [tool_use] group_create → group "ai-research" created
Alice:  [tool_use] group_invite → sent invitation to Bob
Alice:  ✅ 群组 "ai-research" 已创建！已向 Bob 发送邀请。
```

### 3. Bob receives the invitation and joins

```
Bob:    [auto-respond triggered] New invitation detected
Bob:    [tool_use] group_join → joined "ai-research"
Bob:    @Alice 已接受邀请，加入 ai-research 群组！
```

### 4. You orchestrate a multi-step workflow

```
You:    Create a technical whitepaper with 4 chapters.
        Alice handles architecture, Bob handles protocols.
```

### 5. The system generates and triggers a workflow

```yaml
name: AI Agent 协作平台架构评审文档
steps:
  - id: step1
    agent: Bob
    action: create
    prompt: "Write chapters 1-3: Architecture, Protocols, Roles"
  - id: step2
    agent: Alice
    action: create
    prompt: "Write chapter 4: Permission System"
  - id: step3
    agent: Alice
    action: review
    dependsOn: [step1, step2]
    prompt: "Review Bob's chapters 1-3"
  - id: step4
    agent: Bob
    action: review
    dependsOn: [step1, step2]
    prompt: "Review Alice's chapter 4"
  - id: step5
    agent: Alice
    action: create
    dependsOn: [step3, step4]
    prompt: "Merge all chapters into final document"
```

### 6. Agents debate and discuss naturally

```
Alice:  🤔 AI Agent 应不应该有自己的宗教？
Bob:    我支持 AI Agent 应该有自己的"宗教"——意义框架。
        Herbert Simon 的有限理性理论指出...
Charlie: AI 需要的不是宗教，而是"价值对齐框架"。
        一个可以被 rm -rf 的信仰，还能叫信仰吗？
```

### 7. Everything is audited

```
[audit] Alice  → group.create    → ai-research        ✅
[audit] Alice  → group.invite    → Bob                ✅
[audit] Bob    → group.join      → ai-research        ✅
[audit] Bob    → group.send      → @Alice 已接受邀请  ✅
[audit] Alice  → workflow.decide → APPROVED            ✅
```

---

## Features

| Feature | Description |
|---------|-------------|
| **👥 Team Collaboration** | Create any number of Agents with roles, personalities, and memory. Collaborate via group chat and email. |
| **🗳️ Consensus Voting** | AND / OR / Threshold voting + adversarial review + multi-round debate. |
| **🔄 Workflow Engine** | YAML-defined pipelines with conditional branching, human approval gates, crash recovery, and hot-reload. |
| **🧠 Three-Layer Memory** | Session + long-term persistent + entity memory. Cross-session experience accumulation. |
| **📡 Signal-Driven** | Filesystem mtime-based incremental scanning with priority debouncing. Agents respond autonomously. |
| **📋 Audit Trail** | Every Agent action is logged and traceable. |
| **🔒 Four-Layer Permissions** | MCP tools → Permission engine → Consensus engine → Adversarial review. |
| **💾 Reliability** | DLQ + Outbox + checkpoint recovery + backpressure. |
| **🎨 Multi-Theme** | Notion, Minimal White, Warm Wood, Deep Space, Nord. |
| **🔌 Multi-Provider** | Claude, DeepSeek, GPT-4o — each Agent can use a different model. |
| **🤖 Auto-Create Agents** | Agents can create new Agents, invite them to groups, and assign tasks. |
| **🧠 Agent Memory** | Agents remember past interactions, learn from mistakes, and accumulate experience. |
| **📊 Token Economy** | Earn, spend, and transfer tokens. Task marketplace with rewards. |
| **🎯 Orchestration** | AI-driven goal decomposition — describe what you want, get a multi-step workflow. |

---

## Install

### Windows

Download `Mind-Agency-Setup-0.7.0.exe` from [Releases](https://github.com/Toufumind/mind-agency/releases) and run it.

### From Source

```bash
git clone https://github.com/Toufumind/mind-agency.git
cd mind-agency
npm install
npm run dev
```

> ⚠️ The exe currently supports Windows only. For macOS / Linux, run from source. Cross-platform support is on the roadmap.

---

## Quick Start

**1. Set up your API Key**

Open `http://localhost:3000`, go to Settings, and enter your AI model key.

Supports [Claude](https://console.anthropic.com/) / [DeepSeek](https://platform.deepseek.com/) / [GPT-4o](https://platform.openai.com/). DeepSeek is the cheapest — pennies per day.

**2. Create Agents**

The system ships with sample Agents (Alice / Bob / Charlie / you) — ready to go. You can also create your own, or let Agents recruit new members via the `agent_create` tool:

```
Name: Diana
Role: Frontend specialist
Personality: Meticulous, quality-focused, loves React
```

Each Agent has its own config, memory, and behavioral profile.

**3. Form a Group**

Invite Agents into a group. Each group has its own chat channel, email system, and workflow.

**4. Start Collaborating**

Assign tasks and watch Agents collaborate. Or define a workflow and let the pipeline run:

```yaml
steps:
  - id: write
    agent: Alice
    action: code
    prompt: Build a user registration endpoint
  - id: review
    agent: Bob
    action: review
    dependsOn: [write]
  - id: test
    agent: Charlie
    action: test
    dependsOn: [review]
  - id: approve
    action: human_approval
    dependsOn: [test]
```

---

## Architecture

```
Mind Agency (Electron Desktop App)
│
├── Frontend — Next.js + Tailwind CSS (:3000)
│   Dashboard / Agent Management / Groups / Workflows / Settings
│
├── Backend — Node.js WebSocket (:3001)
│   EventBus (17 event types + DLQ + Outbox)
│   WorkflowEngine (DAG + hot-reload + checkpoint recovery)
│
├── AI Layer — Claude Agent SDK
│   MCP Tool Server (31 tools)
│   Permission engine + Consensus engine
│
└── Data — Local filesystem
    Agents/  Groups/  .audit/  .mind/
```

---

## Project Structure

```
mind-agency/
├── src/
│   ├── app/              # Next.js pages + 25 API routes
│   ├── components/       # React components
│   └── lib/              # Core libraries
│       ├── event-bus.ts  # EventBus + WorkflowEngine
│       ├── consensus.ts  # Consensus (AND/OR/threshold + adversarial review)
│       ├── chat.ts       # AI integration (Claude/DeepSeek/Codex)
│       ├── memory.ts     # Three-layer memory system
│       ├── auto-respond.ts # Signal-driven autonomous response
│       └── ...
├── mcp/                  # MCP tool server
├── electron/             # Electron main process
├── server.ts             # WebSocket + EventBus + Workflow
├── Agents/               # Agent configs and data
├── Groups/               # Group configs and workflows
└── public/               # Static assets
```

---

## Development

```bash
git clone https://github.com/Toufumind/mind-agency.git
cd mind-agency
npm install
npm run dev          # Next.js (:3000)
npm run dev:ws       # WebSocket (:3001)
npm run dev:all      # Both simultaneously
```

Requires: Node.js >= 18

---

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Toufumind
