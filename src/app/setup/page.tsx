'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Key, Globe, Cpu, ArrowRight, Check, Loader2, Users, MessageCircle, GitBranch } from 'lucide-react';
import Link from 'next/link';
import LogoCanvas from '@/components/logo-canvas';

export default function SetupPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'greeting' | 'config'>('greeting');

  return (
    <div className="flex h-full bg-canvas">
      {/* Main — fullscreen, no sidebar during setup */}
      <main className="flex-1 flex items-center justify-center bg-canvas overflow-hidden">
        <div className="w-[480px] max-w-[92vw]">
          {stage === 'greeting' ? (
            <Welcome onNext={() => setStage('config')} onSkip={() => { localStorage.setItem('mind-setup-done', '1'); router.push('/'); }} />
          ) : (
            <ConfigForm onDone={() => { localStorage.setItem('mind-setup-done', '1'); setTimeout(() => router.push('/'), 800); }} />
          )}
        </div>
      </main>
    </div>
  );
}

function Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero icon */}
      <div className="flex items-center justify-center mx-auto mb-6">
        <LogoCanvas size={64} />
      </div>

      {/* Greeting */}
      <h1 className="text-[26px] font-semibold text-foreground mb-3 tracking-tight">
        你好
      </h1>
      <p className="text-[15px] text-muted leading-relaxed max-w-sm mx-auto mb-10">
        欢迎使用 Mind Agency，一个由真实大模型驱动的多 Agent 协作平台。
      </p>

      {/* What you can do */}
      <div className="space-y-1.5 mb-10 text-left max-w-sm mx-auto">
        {[
          { icon: <MessageCircle size={14} />, text: '在群聊里 @Agent，它们会自主回复和协作' },
          { icon: <Users size={14} />, text: '像真实团队一样：群聊讨论、发邮件、组建群组' },
          { icon: <GitBranch size={14} />, text: '定义 Workflow，Agent 按流水线自动执行任务' },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-[13px] text-muted px-4 py-2">
            <span className="text-muted-foreground shrink-0">{item.icon}</span>
            {item.text}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={onSkip} className="text-[13px] text-muted-foreground hover:text-muted transition-colors">
          我先逛逛
        </button>
        <button onClick={onNext}
          className="flex items-center gap-2 px-6 py-2.5 bg-foreground text-canvas text-[13px] font-medium rounded-xl hover:opacity-90 transition-all">
          开始配置
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function ConfigForm({ onDone }: { onDone: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/anthropic');
  const [model, setModel] = useState('deepseek-v4-pro');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');

  const save = async () => {
    setStatus('saving');
    try {
      const r = await fetch('/api/system/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey || undefined, baseUrl, model }),
      });
      const d = await r.json();
      if (d.success) { setStatus('done'); onDone(); }
      else setStatus('idle');
    } catch { setStatus('idle'); }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {status === 'done' ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-success-muted flex items-center justify-center mx-auto mb-5">
            <Check size={28} className="text-success" />
          </div>
          <p className="text-[16px] font-semibold text-muted mb-1">一切就绪</p>
          <p className="text-[13px] text-muted-foreground">Agent 已上线，正在跳转…</p>
        </div>
      ) : (
        <>
          <div className="text-center mb-8">
            <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center mx-auto mb-3">
              <Key size={16} className="text-canvas" />
            </div>
            <h2 className="text-[20px] font-semibold text-foreground mb-2">连接大模型</h2>
            <p className="text-[13px] text-muted-foreground">
              Agent 需要 API 才能思考和回复。支持 Anthropic 和 DeepSeek。
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2 text-[12px] font-medium text-muted mb-2">
                <Key size={13} className="text-muted-foreground" /> API 密钥
              </label>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..." type="password"
                className="w-full px-4 py-3 border border-border rounded-xl text-[13px] font-mono outline-none focus:border-border-strong focus:ring-1 focus:ring-surface transition-all"
                autoFocus />
              <p className="mt-1.5 text-[11px] text-muted-foreground">DeepSeek：platform.deepseek.com → API Keys</p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-[12px] font-medium text-muted mb-2">
                <Globe size={13} className="text-muted-foreground" /> Base URL
              </label>
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/anthropic"
                className="w-full px-4 py-3 border border-border rounded-xl text-[13px] outline-none focus:border-border-strong focus:ring-1 focus:ring-surface transition-all" />
            </div>

            <div>
              <label className="flex items-center gap-2 text-[12px] font-medium text-muted mb-2">
                <Cpu size={13} className="text-muted-foreground" /> 模型
              </label>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full px-4 py-3 border border-border rounded-xl text-[13px] outline-none focus:border-border-strong bg-canvas appearance-none cursor-pointer">
                <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                <option value="deepseek-v4-flash">DeepSeek V4 Flash（更快）</option>
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-opus-4-20250514">Claude Opus 4</option>
              </select>
            </div>

            <div className="flex items-center justify-between pt-3">
              <button onClick={() => { localStorage.setItem('mind-setup-done', '1'); window.location.href = '/'; }}
                className="text-[12px] text-muted-foreground hover:text-muted transition-colors">
                跳过，之后设置
              </button>
              <button onClick={save} disabled={status === 'saving'}
                className="flex items-center gap-2 px-6 py-2.5 bg-foreground text-canvas text-[13px] font-medium rounded-xl hover:opacity-90 disabled:opacity-50 transition-all">
                {status === 'saving' ? (
                  <><Loader2 size={14} className="animate-spin" /> 保存中…</>
                ) : (
                  <>保存并开始 <ArrowRight size={14} /></>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
