'use client';
import { useState, useEffect } from 'react';
import { Plus, Trash2, Check, Loader2, RefreshCw, Zap } from 'lucide-react';
import { PROVIDER_PRESETS, type ProviderPreset } from '@/lib/provider-presets';

interface ProviderProfile {
  id: string;
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
  createdAt: number;
}

export default function ProviderProfiles({ lang }: { lang: string }) {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newProfile, setNewProfile] = useState<{ name: string; provider: 'claude' | 'codex'; apiKey: string; baseUrl: string; model: string }>({ name: '', provider: 'claude', apiKey: '', baseUrl: '', model: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/system/providers');
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (e) { console.error('[components:settings:ProviderProfiles]', e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activate = async (id: string) => {
    setActivating(id);
    try {
      await fetch(`/api/system/providers?id=${id}&action=activate`, { method: 'PUT' });
      await load();
    } catch (e) { console.error('[components:settings:ProviderProfiles]', e); }
    setActivating(null);
  };

  const add = async () => {
    if (!newProfile.name || !newProfile.apiKey || !newProfile.baseUrl) return;
    try {
      await fetch('/api/system/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProfile),
      });
      setNewProfile({ name: '', provider: 'claude', apiKey: '', baseUrl: '', model: '' });
      setShowAdd(false);
      await load();
    } catch (e) { console.error('[components:settings:ProviderProfiles]', e); }
  };

  const remove = async (id: string) => {
    if (!confirm(lang === 'zh' ? '确定删除？' : 'Delete this profile?')) return;
    try {
      await fetch(`/api/system/providers?id=${id}`, { method: 'DELETE' });
      await load();
    } catch (e) { console.error('[components:settings:ProviderProfiles]', e); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">
            {lang === 'zh' ? '供应商配置' : 'Provider Profiles'}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {lang === 'zh' ? '管理多个 API 配置，一键切换' : 'Manage multiple API configs, switch with one click'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-surface-alt text-muted-foreground">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-canvas text-[12px] font-medium hover:opacity-90">
            <Plus size={14} /> {lang === 'zh' ? '添加' : 'Add'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="p-4 bg-canvas border border-border rounded-xl space-y-3">
          {/* Preset selector */}
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">
              {lang === 'zh' ? '快速选择供应商' : 'Quick select provider'}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {PROVIDER_PRESETS.map(p => (
                <button key={p.id} onClick={() => setNewProfile({
                  ...newProfile,
                  name: p.name,
                  provider: p.provider,
                  baseUrl: p.baseUrl,
                  model: p.model,
                })}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] border transition-colors text-left
                    ${newProfile.baseUrl === p.baseUrl && newProfile.name === p.name
                      ? 'border-foreground/30 bg-surface'
                      : 'border-border hover:border-border-strong'}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || '#6B7280' }} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          <input value={newProfile.name} onChange={e => setNewProfile({ ...newProfile, name: e.target.value })}
            placeholder={lang === 'zh' ? '名称' : 'Name'}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[12px] outline-none focus:border-foreground/30" />
          <select value={newProfile.provider} onChange={e => setNewProfile({ ...newProfile, provider: e.target.value as any })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[12px] outline-none">
            <option value="claude">Claude / DeepSeek</option>
            <option value="codex">Codex / OpenAI</option>
          </select>
          <input value={newProfile.apiKey} onChange={e => setNewProfile({ ...newProfile, apiKey: e.target.value })}
            placeholder="API Key" type="password"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[12px] font-mono outline-none focus:border-foreground/30" />
          <input value={newProfile.baseUrl} onChange={e => setNewProfile({ ...newProfile, baseUrl: e.target.value })}
            placeholder="Base URL"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[12px] outline-none focus:border-foreground/30" />
          <input value={newProfile.model} onChange={e => setNewProfile({ ...newProfile, model: e.target.value })}
            placeholder="Model"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-[12px] outline-none focus:border-foreground/30" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button onClick={add} className="px-4 py-1.5 rounded-lg bg-foreground text-canvas text-[12px] font-medium hover:opacity-90">
              {lang === 'zh' ? '保存' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Profile list */}
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>
      ) : profiles.length === 0 ? (
        <p className="text-[12px] text-muted-foreground text-center py-6">
          {lang === 'zh' ? '暂无配置，点击"添加"创建第一个' : 'No profiles yet. Click "Add" to create one.'}
        </p>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => (
            <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors
              ${p.isActive ? 'border-foreground/20 bg-surface shadow-sm' : 'border-border hover:border-border-strong'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground truncate">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-muted-foreground">{p.provider}</span>
                  {p.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
                    {lang === 'zh' ? '使用中' : 'Active'}
                  </span>}
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{p.baseUrl} · {p.model}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {!p.isActive && (
                  <button onClick={() => activate(p.id)} disabled={activating === p.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-foreground text-canvas hover:opacity-90 disabled:opacity-50">
                    {activating === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {lang === 'zh' ? '切换' : 'Switch'}
                  </button>
                )}
                <button onClick={() => remove(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
