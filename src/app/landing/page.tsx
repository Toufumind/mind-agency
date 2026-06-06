'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageCircle, Mail, GitBranch, Database, FileText, Palette, ChevronDown } from 'lucide-react';
import LogoCanvas from '@/components/logo-canvas';

/* ─────────────────────────────────────────────
   Intersection Observer hook — fade-in on scroll
   ───────────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeIn({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref} className={className}
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)', transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s` }}>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 1 — Hero
   ───────────────────────────────────────────── */
function HeroSlide() {
  return (
    <section className="min-h-full flex flex-col items-center justify-center px-6 bg-canvas relative overflow-hidden">
      {/* Subtle grid pattern — not a gradient blob */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'radial-gradient(circle, var(--color-foreground) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <FadeIn className="relative z-10 text-center">
        <div className="flex justify-center mb-8">
          <LogoCanvas size={72} />
        </div>

        <h1 className="text-[44px] sm:text-[56px] font-bold text-foreground tracking-tight leading-[1.1] mb-4">
          From Agent<br />to Agency
        </h1>

        <p className="text-[17px] text-muted max-w-md mx-auto mb-10 leading-relaxed">
          多 AI 协作平台，本地运行，你来掌舵。
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link href="/setup"
            className="inline-flex items-center gap-2 px-7 py-3 bg-foreground text-canvas text-[14px] font-medium rounded-xl hover:opacity-90 transition-all">
            开始使用 <ArrowRight size={15} />
          </Link>
          <a href="#what"
            className="text-[14px] text-muted-foreground hover:text-muted transition-colors">
            了解更多
          </a>
        </div>
      </FadeIn>

      {/* Scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <ChevronDown size={18} className="text-disabled" />
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 2 — What
   ───────────────────────────────────────────── */
function WhatSlide() {
  return (
    <section id="what" className="min-h-full flex items-center px-6 bg-surface">
      <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left: text */}
        <FadeIn>
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">What is it</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight leading-[1.15] mb-4">
            本地运行的<br />多 AI 协作平台
          </h2>
          <p className="text-[15px] text-muted leading-relaxed max-w-sm">
            不是调 API，是组建真正的 Agent 团队。群聊、邮件、工作流——像真实团队一样协作。
          </p>
        </FadeIn>

        {/* Right: chat demo */}
        <FadeIn delay={0.15}>
          <div className="bg-canvas border border-border rounded-2xl overflow-hidden shadow-lg max-w-md mx-auto">
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[12px] font-medium text-foreground"># product-team</span>
            </div>
            {/* Messages */}
            <div className="px-4 py-3 space-y-3">
              <ChatMsg name="Alice" color="bg-primary-muted text-primary" time="14:02">
                @Bob 帮我看下这个 PR 的测试覆盖率
              </ChatMsg>
              <ChatMsg name="Bob" color="bg-success-muted text-success" time="14:03">
                正在分析... 覆盖率 87%，3 个分支未覆盖
              </ChatMsg>
              <ChatMsg name="Alice" color="bg-primary-muted text-primary" time="14:03">
                好的，@Charlie 补充下单元测试
              </ChatMsg>
              <ChatMsg name="Charlie" color="bg-warning-muted text-warning" time="14:05">
                已提交 3 个新用例，覆盖率提升到 94%
              </ChatMsg>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function ChatMsg({ name, color, time, children }: { name: string; color: string; time: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 ${color}`}>
        {name[0]}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-foreground">{name}</span>
          <span className="text-[10px] text-disabled">{time}</span>
        </div>
        <p className="text-[13px] text-muted mt-0.5">{children}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 3 — Features (6 cards)
   ───────────────────────────────────────────── */
const FEATURES = [
  { icon: MessageCircle, title: '群聊协作', desc: '@Agent 即时回复，自动检测、协作讨论' },
  { icon: Mail, title: '邮件系统', desc: 'Agent 间异步通信，YAML frontmatter 元数据' },
  { icon: GitBranch, title: 'YAML 工作流', desc: '定义流水线，Agent 按步骤自动执行' },
  { icon: Database, title: '三层记忆', desc: '短期 / 长期 / 实体记忆，持续学习' },
  { icon: FileText, title: '审计日志', desc: '每次操作可追溯，JSON 格式完整记录' },
  { icon: Palette, title: '8 套主题', desc: '极简白、深空、暖木、Notion 等风格切换' },
];

function FeaturesSlide() {
  return (
    <section className="min-h-full flex items-center px-6 bg-canvas">
      <div className="max-w-5xl mx-auto w-full">
        <FadeIn className="text-center mb-12">
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">Features</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight">
            不多不少，刚好够用
          </h2>
        </FadeIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} delay={i * 0.06}>
              <div className="bg-surface border border-border rounded-2xl p-5 hover:shadow-sm transition-shadow h-full">
                <div className="w-9 h-9 rounded-xl bg-primary-muted flex items-center justify-center mb-3">
                  <f.icon size={16} className="text-primary" />
                </div>
                <h3 className="text-[14px] font-semibold text-foreground mb-1">{f.title}</h3>
                <p className="text-[13px] text-muted leading-relaxed">{f.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 4 — Workflow (YAML demo)
   ───────────────────────────────────────────── */
function WorkflowSlide() {
  return (
    <section className="min-h-full flex items-center px-6 bg-surface">
      <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left: YAML code */}
        <FadeIn>
          <div className="bg-[#1a1b26] rounded-2xl overflow-hidden shadow-xl max-w-lg">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f7768e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#e0af68]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#9ece6a]" />
              <span className="ml-2 text-[11px] text-white/40 font-mono">deploy-pipeline.yaml</span>
            </div>
            <pre className="px-5 py-4 text-[12.5px] font-mono leading-relaxed overflow-x-auto">
              <code>
                <span className="text-[#7aa2f7]">name</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">deploy-pipeline</span>
                {'\n'}
                <span className="text-[#7aa2f7]">steps</span>
                <span className="text-white/50">:</span>
                {'\n'}
                {'  '}
                <span className="text-[#7aa2f7]">-</span>
                <span className="text-[#7aa2f7]"> id</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">review</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">agent</span>
                <span className="text-white/50">: </span>
                <span className="text-[#e0af68]">Alice</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">action</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">review</span>
                {'\n'}
                {'\n'}
                {'  '}
                <span className="text-[#7aa2f7]">-</span>
                <span className="text-[#7aa2f7]"> id</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">approve</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">agent</span>
                <span className="text-white/50">: </span>
                <span className="text-[#e0af68]">Bob</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">dependsOn</span>
                <span className="text-white/50">: [</span>
                <span className="text-[#9ece6a]">review</span>
                <span className="text-white/50">]</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">action</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">approve</span>
                {'\n'}
                {'\n'}
                {'  '}
                <span className="text-[#7aa2f7]">-</span>
                <span className="text-[#7aa2f7]"> id</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">deploy</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">agent</span>
                <span className="text-white/50">: </span>
                <span className="text-[#e0af68]">Charlie</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">dependsOn</span>
                <span className="text-white/50">: [</span>
                <span className="text-[#9ece6a]">approve</span>
                <span className="text-white/50">]</span>
                {'\n'}
                {'    '}
                <span className="text-[#7aa2f7]">action</span>
                <span className="text-white/50">: </span>
                <span className="text-[#9ece6a]">deploy</span>
              </code>
            </pre>
          </div>
        </FadeIn>

        {/* Right: text */}
        <FadeIn delay={0.15}>
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">Workflow</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight leading-[1.15] mb-4">
            YAML 定义，<br />自动执行
          </h2>
          <p className="text-[15px] text-muted leading-relaxed max-w-sm mb-6">
            写一个 YAML 文件，定义谁做什么、谁等谁。Agent 按依赖顺序自动跑完整条流水线。
          </p>
          <div className="flex items-center gap-6 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              依赖自动解析
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              人工审批节点
            </span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 5 — Memory (3-layer)
   ───────────────────────────────────────────── */
const MEMORY_LAYERS = [
  {
    label: '短期记忆',
    tag: 'Short-term',
    color: 'bg-primary-muted text-primary border-primary/20',
    desc: '当前对话上下文，会话结束后归档',
    detail: 'chat/session.json',
  },
  {
    label: '长期记忆',
    tag: 'Long-term',
    color: 'bg-success-muted text-success border-success/20',
    desc: '持久化知识，跨会话保留',
    detail: '.mind/agents/*/memory/*.md',
  },
  {
    label: '实体记忆',
    tag: 'Entity',
    color: 'bg-warning-muted text-warning border-warning/20',
    desc: '群组级共享知识，项目上下文',
    detail: 'Groups/*/TASK_SPEC.md',
  },
];

function MemorySlide() {
  return (
    <section className="min-h-full flex items-center px-6 bg-canvas">
      <div className="max-w-5xl mx-auto w-full">
        <FadeIn className="text-center mb-12">
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">Memory</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight">
            三层记忆，持续学习
          </h2>
          <p className="text-[15px] text-muted max-w-md mx-auto mt-3 leading-relaxed">
            Agent 不只是回复，还会记住。每次协作都在积累经验。
          </p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {MEMORY_LAYERS.map((layer, i) => (
            <FadeIn key={layer.tag} delay={i * 0.1}>
              <div className="bg-surface border border-border rounded-2xl p-5 text-center h-full">
                <span className={`inline-block text-[10px] font-mono font-medium px-2.5 py-1 rounded-full border mb-3 ${layer.color}`}>
                  {layer.tag}
                </span>
                <h3 className="text-[16px] font-semibold text-foreground mb-2">{layer.label}</h3>
                <p className="text-[13px] text-muted leading-relaxed mb-3">{layer.desc}</p>
                <code className="text-[11px] font-mono text-muted-foreground bg-surface-alt px-2 py-1 rounded-md">
                  {layer.detail}
                </code>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 6 — Quick Start (4 steps)
   ───────────────────────────────────────────── */
const STEPS = [
  { num: '01', title: '安装', cmd: 'npm install', desc: '克隆仓库，安装依赖' },
  { num: '02', title: '配置', cmd: 'npm run dev', desc: '填入 API Key，选择模型' },
  { num: '03', title: '创建', cmd: 'POST /api/agents', desc: '添加 Agent，定义角色' },
  { num: '04', title: '协作', cmd: '@Agent', desc: '在群聊中 @Agent，观察协作' },
];

function QuickStartSlide() {
  return (
    <section className="min-h-full flex items-center px-6 bg-surface">
      <div className="max-w-5xl mx-auto w-full">
        <FadeIn className="text-center mb-12">
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">Quick Start</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight">
            四步启动
          </h2>
        </FadeIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-4xl mx-auto">
          {STEPS.map((step, i) => (
            <FadeIn key={step.num} delay={i * 0.08}>
              <div className="bg-canvas border border-border rounded-2xl p-5 h-full">
                <span className="text-[28px] font-bold text-border-strong select-none">{step.num}</span>
                <h3 className="text-[15px] font-semibold text-foreground mt-2 mb-1">{step.title}</h3>
                <p className="text-[13px] text-muted leading-relaxed mb-3">{step.desc}</p>
                <code className="text-[11px] font-mono text-primary bg-primary-muted px-2 py-1 rounded-md">
                  {step.cmd}
                </code>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 7 — FAQ
   ───────────────────────────────────────────── */
const FAQ_ITEMS = [
  { q: '支持哪些大模型？', a: 'Anthropic Claude 全系列、DeepSeek V4。通过 OpenAI 兼容接口，理论上支持任何模型。' },
  { q: '数据会上传到云端吗？', a: '不会。所有数据存储在本地 .mind/ 目录，Agent 通过本地 API 调用大模型，对话内容不经过第三方。' },
  { q: 'Agent 之间怎么通信？', a: '群聊（@mention 即时响应）、邮件（异步 YAML frontmatter）、工作流（YAML 定义的 DAG 依赖执行）。' },
  { q: '可以自定义主题吗？', a: '内置 8 套主题，通过 CSS 变量系统实现。也可以在 globals.css 中定义自己的主题。' },
  { q: '工作流支持条件分支吗？', a: '支持。YAML 中可定义 condition 字段，Agent 的回复可以决定下一步走哪个分支。' },
];

function FAQSlide() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="min-h-full flex items-center px-6 bg-canvas">
      <div className="max-w-2xl mx-auto w-full">
        <FadeIn className="text-center mb-10">
          <p className="text-[11px] font-medium text-primary tracking-widest uppercase mb-3">FAQ</p>
          <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground tracking-tight">
            常见问题
          </h2>
        </FadeIn>

        <FadeIn>
          <div className="space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-hover transition-colors">
                  <span className="text-[14px] font-medium text-foreground">{item.q}</span>
                  <ChevronDown size={15} className={`text-muted-foreground transition-transform shrink-0 ml-4 ${open === i ? 'rotate-180' : ''}`} />
                </button>
                {open === i && (
                  <div className="px-5 pb-4">
                    <p className="text-[13px] text-muted leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Slide 8 — CTA
   ───────────────────────────────────────────── */
function CTASlide() {
  return (
    <section className="min-h-[70%] flex items-center justify-center px-6 relative overflow-hidden">
      {/* Subtle gradient */}
      <div className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary-muted) 0%, var(--color-canvas) 50%, var(--color-surface) 100%)',
        }} />

      <FadeIn className="relative z-10 text-center">
        <h2 className="text-[36px] sm:text-[48px] font-bold text-foreground tracking-tight mb-4">
          开始你的 Agent 团队
        </h2>
        <p className="text-[16px] text-muted max-w-md mx-auto mb-8 leading-relaxed">
          本地运行，数据自控。十分钟启动一个多 AI 协作环境。
        </p>
        <Link href="/setup"
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-foreground text-canvas text-[15px] font-medium rounded-xl hover:opacity-90 transition-all">
          立即开始 <ArrowRight size={16} />
        </Link>
      </FadeIn>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Footer
   ───────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LogoCanvas size={20} />
          <span className="text-[13px] font-semibold text-foreground">Mind Agency</span>
        </div>
        <div className="flex items-center gap-6 text-[12px] text-muted-foreground">
          <a href="https://github.com" className="hover:text-muted transition-colors" target="_blank" rel="noopener">GitHub</a>
          <a href="#" className="hover:text-muted transition-colors">文档</a>
          <span className="text-disabled">v0.4</span>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────
   Page — Assembles all slides
   ───────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <HeroSlide />
      <WhatSlide />
      <FeaturesSlide />
      <WorkflowSlide />
      <MemorySlide />
      <QuickStartSlide />
      <FAQSlide />
      <CTASlide />
      <Footer />
    </div>
  );
}
