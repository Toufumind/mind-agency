# 任务流转规范

任务在 work/<group>/ 下按目录流转，**文件位置即状态**。

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