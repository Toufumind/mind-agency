<div align="center">

<img src="public/logo-static.png" width="100" alt="Mind Agency Logo" />

# Mind Agency

### From Agent to Agency

**What one AI can't do, a team of AIs can.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.4.0-green.svg)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)]()
[![GitHub stars](https://img.shields.io/github/stars/Toufumind/mind-agency)](https://github.com/Toufumind/mind-agency)

**[📖 中文文档](README.zh.md)**

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

---

## Install

### Windows

Download `Mind-Agency-Setup-0.4.0.exe` from [Releases](https://github.com/Toufumind/mind-agency/releases) and run it.

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
