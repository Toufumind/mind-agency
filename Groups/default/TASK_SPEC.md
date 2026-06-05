# 任务流转规范

任务在 `work/<group>/` 下按目录流转，**文件位置即状态**。

## 目录结构

```
work/<group>/
├── inbox/                  # 待分配
├── assigned/<agent>/       # 各 Agent 的工作队列
└── done/                   # 已完成
```

## 状态流转

```
inbox/ → assigned/<agent>/ → done/
  ↓           ↓                  ↓
 new      in_progress          done
```

## 任务文件格式（YAML + Markdown）

```yaml
---
id: "2026-05-31-001"
agent: alice
status: new            # new → in_progress → done
priority: normal       # low | normal | high
title: "任务简述"

artefacts:             # 产出物路径
  - docs/xxx.md

context:               # 输入上下文
  repo: ""
  notes: []

next_agent: null       # 接力：完成后交给谁（填 agent 名或 null）
---

## 任务详情

（正文用 Markdown 写）
```

## 操作规则

1. **创建任务** → 写 YAML 文件到 `work/<group>/inbox/`，status=new
2. **认领任务** → 文件移到 `assigned/<agent>/`，status=in_progress
3. **完成任务** → 写入 result 块，文件移到 `done/`，status=done
4. **接力** → 若 next_agent 不为空，由 Coordinator 在 inbox 创建下一环任务
5. **每个 Agent 只看自己目录** → `assigned/<agent>/` 是私有的
