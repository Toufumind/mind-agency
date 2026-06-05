# 「极简白」主题设计规格

> Design Lead: Hugo | 2026-06-04 | v1.0

---

## 一、设计理念

**极简白** 面向 AI 协作工具场景，追求「内容即界面」的阅读体验。三条核心原则：

| 原则 | 说明 |
|------|------|
| **留白优先** | 用空间而非线条分隔内容，减少视觉噪音 |
| **字体即层级** | 仅靠字号、字重、颜色建立信息架构 |
| **单色系 + 一个强调色** | 灰度色板支撑 90% 场景，蓝调仅用于交互关键点 |

参考：DeepSeek、Claude.ai、Linear、Notion 的现代极简风格。

---

## 二、主题色板

### 2.1 灰度体系（Neutral Gray）

```
50  #fafafa → 页面底色、侧边栏
100 #f5f5f5 → 卡片悬停、次要分区
200 #eaeaea → 分割线（subtle）
300 #d9d9d9 → 边框默认
400 #b0b0b0 → 边框强调
500 #8c8c8c → 图标、占位符
600 #636363 → 次要文字
700 #3d3d3d → 正文
800 #1f1f1f → 标题
900 #0f0f0f → 主要文字（最深，非纯黑）
```

### 2.2 强调色（Accent Blue）

沿用现有 `agency` 品牌蓝，微调色阶使其更柔和：

```
50  #eff3ff → 选中态背景
100 #dbe4ff → 标签背景
200 #bac8ff
300 #91a7ff
400 #748ffc
500 #5c7cfa → 主按钮、链接
600 #4c6ef5 → 悬停态
700 #4263eb
800 #3b5bdb
900 #364fc7
```

### 2.3 功能色

```
success  #10b981 → 在线状态、成功提示
warning  #f59e0b → 警告
error    #ef4444 → 错误、删除、徽标
info     #3b82f6 → 信息提示
```

---

## 三、设计 Token

### 3.1 字体

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | `'Inter', system-ui, -apple-system, sans-serif` | 全局 |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', monospace` | 代码、技术输出 |

### 3.2 字号

| Token | rem | px | 用途 |
|-------|-----|-----|------|
| `--text-2xs` | 0.625rem | 10px | 标签、徽标数字 |
| `--text-xs` | 0.75rem | 12px | 辅助信息、时间戳 |
| `--text-sm` | 0.8125rem | 13px | 正文（列表、侧边栏） |
| `--text-base` | 0.875rem | 14px | 正文（聊天）、按钮 |
| `--text-md` | 1rem | 16px | 标题 H3 |
| `--text-lg` | 1.125rem | 18px | 标题 H2 |
| `--text-xl` | 1.25rem | 20px | 标题 H1 |

### 3.3 字重

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-normal` | 400 | 正文 |
| `--font-medium` | 500 | 导航、按钮、强调 |
| `--font-semibold` | 600 | 标题、卡片标题 |

### 3.4 行高

| Token | 值 | 用途 |
|-------|-----|------|
| `--leading-tight` | 1.25 | 标题 |
| `--leading-normal` | 1.5 | 正文 |
| `--leading-relaxed` | 1.625 | 聊天消息 |

### 3.5 间距（4px 基准）

| Token | rem | px |
|-------|-----|-----|
| `--space-1` | 0.25rem | 4px |
| `--space-1.5` | 0.375rem | 6px |
| `--space-2` | 0.5rem | 8px |
| `--space-2.5` | 0.625rem | 10px |
| `--space-3` | 0.75rem | 12px |
| `--space-4` | 1rem | 16px |
| `--space-5` | 1.25rem | 20px |
| `--space-6` | 1.5rem | 24px |
| `--space-8` | 2rem | 32px |
| `--space-10` | 2.5rem | 40px |
| `--space-12` | 3rem | 48px |

### 3.6 圆角

| Token | rem | px | 用途 |
|-------|-----|-----|------|
| `--radius-sm` | 0.375rem | 6px | Badge、小标签 |
| `--radius-md` | 0.5rem | 8px | 按钮、输入框、卡片 |
| `--radius-lg` | 0.75rem | 12px | 大卡片、面板 |
| `--radius-xl` | 1rem | 16px | 对话框、下拉菜单 |
| `--radius-2xl` | 1.25rem | 20px | 聊天气泡 |

### 3.7 阴影

```
--shadow-xs : 0 1px 2px rgba(0,0,0,0.04)
--shadow-sm : 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
--shadow-md : 0 4px 6px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04)
--shadow-lg : 0 10px 15px rgba(0,0,0,0.06), 0 4px 6px rgba(0,0,0,0.04)
--shadow-xl : 0 20px 25px rgba(0,0,0,0.08), 0 8px 10px rgba(0,0,0,0.04)
```

注意：极简白阴影**全部使用 `rgba(0,0,0,…)`**，不使用蓝灰调。保持中性。

---

## 四、关键 UI 元素规格

### 4.1 侧边栏

```
┌────────────────────────────┐
│  ● Mind Agency      [<]    │  Header: 14px semibold, py-4
│────────────────────────────│  Divider: 1px #eaeaea
│                            │
│  ◇ Dashboard               │  Nav item: 13px, py-2 px-3
│  ◇ Usage                   │  Active: bg-white shadow-sm border
│  ◇ Audit                   │  Inactive: gray-500, hover → gray-700 bg-white/50
│                            │
│  TEAMS              [+]    │  Section: 10px, gray-400, uppercase, tracking-widest
│    # design                │  Group: 13px, gap-2.5
│    # engineering           │  Icon: 20px rounded-md bg-gray-100
│                            │
│  MEMBERS             [+]   │
│    A Alice      ● active   │  Status dot: 6px, emerald-500
│    H Hugo       ○ idle     │  Idle: gray-200
│    B Bob     🛡             │  Admin badge: Shield icon 9px
│                            │
│────────────────────────────│
│  ● 5 agents · 3 groups     │  Footer: 10px, gray-400
└────────────────────────────┘

背景: gray-50  (#fafafa)
边框右: 1px gray-100 (#f5f5f5)
展开宽度: 220px
折叠宽度: 52px
过渡: 200ms ease
```

### 4.2 聊天气泡

```
用户消息 (右对齐):
┌──────────────────────────┐
│  这段代码可以优化一下      │  用户气泡
└──────────────────────────┘  bg: gray-100 (#f3f3f3)
         ◢  (右下直角)        rounded-2xl (20px) rounded-br-sm (4px)
                              max-w: 75%
                              px-4 py-2.5
                              text: 14px, gray-800

AI 消息 (左对齐，无背景):
  Hugging Face 的模型使用...
                              AI 文本
                              bg: transparent
                              text: 14px, gray-700
                              leading-relaxed

系统消息 (居中/左对齐):
┌────────────────────────────┐
│ ┌ Code Block ────────────┐│  系统框
│ │ ...                    ││  bg: gray-50
│ └────────────────────────┘│  border: gray-100
└────────────────────────────┘  rounded-xl (12px)
                                font-mono, 13px
```

### 4.3 输入框

```
┌──────────────────────────────────────┬──┐
│  给 Hugo 发消息...                   │ ↑│
└──────────────────────────────────────┴──┘

容器:
  bg: white
  border: 1px gray-200 (#e5e5e5)
  rounded-2xl (20px)
  px-4 py-3
  gap-2

Focus:
  border: gray-300 → shadow-md
  transition: all 150ms

发送按钮:
  32x32 圆形
  bg: gray-900, hover: gray-700
  icon: ArrowUp 14px, white
  disabled: opacity-20

Placeholder:
  text: 14px, gray-300
```

### 4.4 按钮

```
主按钮:     次按钮:       幽灵按钮:      危险按钮:
┌──────┐   ┌──────┐      ┌──────┐       ┌──────┐
│ 创建  │   │ 取消  │      │ 编辑  │       │ 删除  │
└──────┘   └──────┘      └──────┘       └──────┘
bg:900     bg:white      bg:transparent  bg:red-500
white      border:200    gray-500        white
rounded-lg gray-700      hover:gray-50   hover:red-600

尺寸:
  sm: py-1.5 px-3, text-12px
  md: py-2 px-4, text-13px (默认)
  lg: py-2.5 px-5, text-14px

间距: gap-2 (按钮组)
```

### 4.5 消息列表 / Agent 卡片

```
┌──────────────────────────────────┐
│  ┌──┐                            │
│  │ H│  Hugo               ● 🛡   │  row: py-2 px-3, gap-2.5
│  └──┘  Design Lead               │  avatar: 20px circle, bg-100
│                                  │  name: 13px medium
│  ┌──┐                            │  role: 11px gray-400
│  │ I│  Iris               ○      │  status: right-aligned
│  └──┘  Visual Designer           │
│                                  │
│  ┌──┐                            │  hover: bg-gray-50/50
│  │ L│  Leo                ○      │  active: bg-white shadow-sm border
│  └──┘  Design Technologist       │
└──────────────────────────────────┘
```

---

## 五、TailwindCSS v4 @theme 配置

```css
/* globals.css — 「极简白」主题 */
@import "tailwindcss";

@theme {
  /* ── 字体 ── */
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;

  /* ── 字号 ── */
  --text-2xs: 0.625rem;
  --text-2xs--line-height: 1rem;
  --text-xs: 0.75rem;
  --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem;
  --text-sm--line-height: 1.25rem;
  --text-base: 0.875rem;
  --text-base--line-height: 1.5rem;
  --text-md: 1rem;
  --text-md--line-height: 1.5rem;
  --text-lg: 1.125rem;
  --text-lg--line-height: 1.5rem;
  --text-xl: 1.25rem;
  --text-xl--line-height: 1.75rem;

  /* ── 字重 ── */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* ── 灰度色板 ── */
  --color-gray-50: #fafafa;
  --color-gray-100: #f5f5f5;
  --color-gray-200: #eaeaea;
  --color-gray-300: #d9d9d9;
  --color-gray-400: #b0b0b0;
  --color-gray-500: #8c8c8c;
  --color-gray-600: #636363;
  --color-gray-700: #3d3d3d;
  --color-gray-800: #1f1f1f;
  --color-gray-900: #0f0f0f;

  /* ── 强调色 ── */
  --color-accent-50: #eff3ff;
  --color-accent-100: #dbe4ff;
  --color-accent-200: #bac8ff;
  --color-accent-300: #91a7ff;
  --color-accent-400: #748ffc;
  --color-accent-500: #5c7cfa;
  --color-accent-600: #4c6ef5;
  --color-accent-700: #4263eb;
  --color-accent-800: #3b5bdb;
  --color-accent-900: #364fc7;

  /* ── 功能色 ── */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* ── 圆角 ── */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.25rem;

  /* ── 阴影 ── */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.06), 0 4px 6px rgba(0, 0, 0, 0.04);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.08), 0 8px 10px rgba(0, 0, 0, 0.04);

  /* ── 间距（扩展默认 4px 基准）── */
  --spacing-1\.5: 0.375rem;
  --spacing-2\.5: 0.625rem;

  /* ── 过渡 ── */
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}

/* ── 全局基础样式 ── */
@layer base {
  body {
    background-color: var(--color-gray-50);
    color: var(--color-gray-900);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: var(--color-gray-300) transparent;
  }
}

/* ── 动画 ── */
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.animate-in    { animation: toast-in 0.3s ease-out; }
.animate-fade  { animation: fade-in 0.2s ease-out; }
.animate-slide { animation: slide-up 0.25s var(--ease-out-expo); }
```

---

## 六、组件 Token 汇总（供 Leo/Bob 对照）

| 组件 | 背景 | 边框 | 圆角 | 文字 | 阴影 |
|------|------|------|------|------|------|
| 侧边栏 | gray-50 | 右 1px gray-100 | — | 13px/500 | — |
| 侧边栏·激活项 | white | gray-100 | lg | 13px/500 gray-900 | sm |
| 用户气泡 | gray-100 | — | 2xl (右下 sm) | 14px gray-800 | — |
| AI 文本 | transparent | — | — | 14px gray-700 | — |
| 输入框 | white | gray-200 → gray-300 (focus) | 2xl | 14px | — |
| 主按钮 | gray-900 | — | md | 13px/500 white | — |
| 次按钮 | white | gray-200 | md | 13px/500 gray-700 | — |
| 对话框 | white | — | xl | — | xl |
| 状态点·在线 | emerald-500 | — | full | — | glow |
| 状态点·离线 | gray-200 | — | full | — | — |
| 徽标 | red-500 | — | full | 9px white | — |

---

## 七、待确认事项

> 以下请 Alice 确认：

1. 强调色沿用现有 `agency-blue` 品牌色系，是否需要调整为更偏冷/暖？
2. 消息区域最大宽度 820px（现有），是否需要调整？
3. 侧边栏折叠宽度 52px（现有），是否保持？
4. 深空科技、暖木两套主题是否沿用同样的 token 结构，仅替换色板？
5. Tailwind v4 `@theme` 方案是否可行？（当前项目用的 v3 config，升级需技术团队评估）

---

*Hugo · Design Lead · 2026-06-04*
