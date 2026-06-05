'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import { Settings, Key, Globe, Cpu, Server, Save, Loader2, Languages, Clock, Palette, ChevronRight } from 'lucide-react';
import { useT } from '@/components/i18n';
import { useTheme, THEMES, type ThemeId } from '@/lib/theme';

export default function SettingsPage() {
  const { lang, t, setLang } = useT();
  const { theme, setTheme } = useTheme();
  const [data, setData] = useState<any>({});
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [port, setPort] = useState('');
  const [wsPort, setWsPort] = useState('');
  const [heartbeatMin, setHeartbeatMin] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system/settings').then(r=>r.json()).then(d => {
      setData(d);
      setApiKey((d.apiKey && !d.apiKey.startsWith('••••')) ? d.apiKey : (d.apiKey || ''));
      setBaseUrl(d.baseUrl || '');
      setModel(d.model || '');
      setPort(d.port ? String(d.port) : '');
      setWsPort(d.wsPort ? String(d.wsPort) : '');
      setHeartbeatMin(d.heartbeatIntervalMs ? String(Math.round(d.heartbeatIntervalMs / 60000 * 10) / 10) : '2');
    }).catch(()=>{});
  }, []);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const body: any = {};
      if (apiKey && !apiKey.startsWith('••••') && apiKey !== data.apiKey) body.apiKey = apiKey;
      else if (!apiKey && data.apiKey) body.apiKey = '';
      if (baseUrl !== data.baseUrl) body.baseUrl = baseUrl || '';
      if (model !== data.model) body.model = model || '';
      if (port && port !== String(data.port || '')) body.port = parseInt(port);
      if (wsPort && wsPort !== String(data.wsPort || '')) body.wsPort = parseInt(wsPort);
      if (heartbeatMin) body.heartbeatIntervalMs = Math.round(parseFloat(heartbeatMin) * 60000);
      const r = await fetch('/api/system/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { setMsg(t('saved_ok')); setData(d.settings); } else setMsg('❌ ' + (d.error || t('save_failed')));
    } catch { setMsg('❌ ' + t('network_error')); }
    setSaving(false);
  };

  const toggle = (key: string) => setExpanded(expanded === key ? null : key);

  return (
    <div className="flex h-full bg-canvas"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <h1 className="text-[18px] font-semibold text-foreground mb-1 flex items-center gap-2"><Settings size={18} className="text-muted-foreground"/> {t('settings')}</h1>
          <p className="text-[12px] text-muted-foreground mb-6">{lang==='zh'?'配置 API、外观和系统参数。':'Configure API, appearance & system.'}</p>

          {/* ── 外观 ── */}
          <Section title={lang==='zh'?'外观':'Appearance'} icon={<Palette size={13}/>}>
            {/* Theme */}
            <SettingItem label={lang==='zh'?'主题':'Theme'} desc={lang==='zh'?'选择界面风格':'Choose interface style'}>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {THEMES.map(th => {
                  const active = theme === th.id;
                  const gradients: Record<string, string> = {
                    'notion': 'linear-gradient(135deg, #ffffff 40%, #f7f6f3 100%)',
                    'minimal-white': 'linear-gradient(135deg, #ffffff 40%, #e9ecef 100%)',
                    'warm-wood': 'linear-gradient(135deg, #faf8f5 40%, #e5dbd0 100%)',
                    'deep-space': 'linear-gradient(135deg, #0d0d12 40%, #32323f 100%)',
                    'nord': 'linear-gradient(135deg, #2e3440 40%, #4c566a 100%)',
                  };
                  return (
                    <button key={th.id} onClick={() => setTheme(th.id as ThemeId)}
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${active ? 'border-foreground/20 bg-surface shadow-sm' : 'border-border hover:border-border-strong'}`}>
                      <div className="w-full h-5 rounded overflow-hidden" style={{ background: gradients[th.id] || gradients['minimal-white'] }} />
                      <span className={`text-[10px] ${active ? 'text-foreground font-medium' : 'text-muted'}`}>{th.labelZh}</span>
                      {active && <span className="absolute -top-1 -right-1 w-3 h-3 bg-foreground rounded-full flex items-center justify-center"><span className="text-[7px] text-canvas font-bold">✓</span></span>}
                    </button>
                  );
                })}
              </div>
            </SettingItem>

            {/* Language */}
            <SettingItem label={t('language')} desc={lang==='zh'?'界面语言':'Interface language'}>
              <div className="flex gap-1.5 mt-1">
                {[['zh','中文'],['en','English']].map(([k,l]) => (
                  <button key={k} onClick={() => { setLang(k as 'zh' | 'en'); localStorage.setItem('mind-lang',k); }}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${lang===k?'bg-foreground text-canvas':'bg-surface-alt text-muted hover:bg-surface-hover'}`}>{l}</button>
                ))}
              </div>
            </SettingItem>
          </Section>

          {/* ── API ── */}
          <Section title="API" icon={<Key size={13}/>}>
            <SettingItem label={t('api_key')} desc={t('api_key_desc')}>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder={data.apiKey ? '•••• (留空保持现有)' : 'sk-...'}
                className="w-full px-3 py-2 border border-border rounded-lg text-[12px] font-mono outline-none focus:border-border-strong mt-1" type="password" />
            </SettingItem>
            <SettingItem label={t('base_url')} desc={t('base_url_desc')}>
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="w-full px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong mt-1" />
            </SettingItem>
            <SettingItem label={t('model')} desc={t('model_desc')}>
              <input value={model} onChange={e => setModel(e.target.value)}
                placeholder="deepseek-v4-flash"
                className="w-full px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong mt-1" />
            </SettingItem>
          </Section>

          {/* ── 系统 ── */}
          <Section title={lang==='zh'?'系统':'System'} icon={<Server size={13}/>}>
            <SettingItem label={t('port')} desc="Next.js 服务端口">
              <input value={port} onChange={e => setPort(e.target.value)} placeholder="3000"
                className="w-24 px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong mt-1" />
            </SettingItem>
            <SettingItem label={t('ws_port')} desc="WebSocket 服务端口">
              <input value={wsPort} onChange={e => setWsPort(e.target.value)} placeholder="3001"
                className="w-24 px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong mt-1" />
            </SettingItem>
          </Section>

          {/* ── Agent ── */}
          <Section title={lang==='zh'?'Agent':'Agent'} icon={<Cpu size={13}/>}>
            <SettingItem label="Heartbeat 间隔" desc={lang==='zh'?'全局默认心跳间隔，各 Agent 可单独覆盖。0 关闭。':'Global heartbeat interval. Per-agent override available. 0=off.'}>
              <div className="flex items-center gap-2 mt-1">
                <input value={heartbeatMin} onChange={e => setHeartbeatMin(e.target.value)} placeholder="2"
                  className="w-20 px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong" />
                <span className="text-[11px] text-muted-foreground">{lang==='zh'?'分钟':'min'}</span>
              </div>
            </SettingItem>
          </Section>

          {/* Save */}
          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} {t('save_config')}
            </button>
            {msg && <span className={`text-[12px] ${msg.startsWith('✅') ? 'text-success' : 'text-destructive'}`}>{msg}</span>}
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">{icon} {title}</h2>
      <div className="bg-surface rounded-xl divide-y divide-border">{children}</div>
    </div>
  );
}

function SettingItem({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">{label}</p>
          {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}
