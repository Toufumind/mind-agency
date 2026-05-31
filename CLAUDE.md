# Mind Agency — Multi-Agent Collaboration Platform

## Quick Start
```bash
cd D:/Projects/Git/Mind/534
npm run dev          # Next.js on :3000
# Agents auto-respond via Poll button or POST /api/poll
```

## Architecture
```
Browser (Next.js + Tailwind) → SSE → claude.exe (DeepSeek-V4-Pro)
                                    ↕ MCP JSON-RPC
                                 group-server.ts (group_chat tools)
```

## Agent Communication
- **Group Chat**: `Groups/<name>/chat/YYYY-MM-DD.md` — agents auto-respond to @mentions
- **Email**: `Agents/<name>/email/` — .md files with YAML frontmatter
- **MCP Tools**: group_create/join/leave/list/send/read

## Key Features
- Autonomous @mention detection & auto-response (30s poll)
- Group membership via `Groups/<name>/Agents/<agent>/`
- Agent config.json with roles & permissions
- Audit logging (.audit/)
- Workflow pipeline automation (workflow.yaml)
- WebSocket notifications (server.ts :3001)
- Token usage monitoring in context bar

## Agent Config Example
```json
{
  "autoRespondToEmail": true,
  "roles": ["admin"],
  "permissions": { "canCreateGroup": true, "canDeleteGroup": false, "canDeploy": false }
}
```
