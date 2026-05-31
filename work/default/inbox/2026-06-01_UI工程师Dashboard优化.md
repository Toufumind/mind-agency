---
id: "2026-06-01-003"
agent: frank
status: new
priority: high
title: "UI 工程师 — Dashboard 组件重构与 UX 打磨"

artefacts:
  - docs/dashboard-ux-plan.md

context:
  repo: "D:/Projects/Git/Mind/534"
  notes:
    - "与 Bob 的底层优化并行，互不阻塞"
    - "聚焦上层：组件、UX、交互"
    - "Bob 负责 SSE 复用、代码分割、资源压缩等底层性能"

next_agent: null
---

## 任务详情

### 目标
重构 Dashboard 前端组件，提升用户体验。

### 具体事项
1. **Dashboard 组件化拆分** — 将现有单文件 Dashboard 拆分为独立组件（MessageList、GroupPanel、ContextBar 等）
2. **Markdown 渲染 UX** — Skeleton 加载占位、渲染完成过渡动画
3. **消息列表虚拟滚动** — 长消息列表性能优化，使用虚拟滚动库
4. **群组切换过渡** — 切换群组时的平滑动画
5. **响应式布局打磨** — 移动端 / 窄屏适配

### 与 Bob 的分工边界
| 层 | 负责人 | 内容 |
|----|--------|------|
| 上层（UX/组件） | Frank | 组件拆分、动画、交互、布局 |
| 底层（性能/基建） | Bob | SSE 复用、代码分割、资源压缩、缓存 |

### 验收标准
- Dashboard 组件可独立渲染测试
- Skeleton 加载态在所有数据组件上生效
- 消息列表 ≥ 1000 条时滚动流畅
- 群组切换有过渡动画

### 预估工时
请 Frank 评估后回复确认。
