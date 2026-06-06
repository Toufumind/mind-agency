'use client';
import { useState, useEffect } from 'react';
import { Search, Download, Trash2, Loader2, ExternalLink, RefreshCw } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  repo: string;
  installedAt: number;
  version: string;
  status: string;
}

interface SearchResult {
  name: string;
  repo: string;
  description: string;
  stars: number;
}

export default function SkillsPanel({ lang }: { lang: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/system/skills');
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadSkills(); }, []);

  const search = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/system/skills?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {}
    setSearching(false);
  };

  const install = async (repo: string) => {
    setInstalling(repo);
    try {
      const res = await fetch('/api/system/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo }),
      });
      if (res.ok) await loadSkills();
    } catch {}
    setInstalling(null);
  };

  const uninstall = async (id: string) => {
    if (!confirm(lang === 'zh' ? '确定卸载？' : 'Uninstall this skill?')) return;
    try {
      await fetch(`/api/system/skills?id=${id}`, { method: 'DELETE' });
      await loadSkills();
    } catch {}
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[13px] font-semibold text-foreground">
          {lang === 'zh' ? 'Skills 技能包' : 'Skills'}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {lang === 'zh' ? '从 GitHub 安装 AI 技能包，注入到 Agent 的 system prompt' : 'Install AI skill packs from GitHub, inject into agent system prompts'}
        </p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder={lang === 'zh' ? '搜索 GitHub 仓库...' : 'Search GitHub repos...'}
          className="flex-1 px-3 py-2 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-foreground/30" />
        <button onClick={search} disabled={searching}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-foreground text-canvas text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {lang === 'zh' ? '搜索' : 'Search'}
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {lang === 'zh' ? `找到 ${searchResults.length} 个结果` : `${searchResults.length} results`}
          </p>
          {searchResults.map(r => (
            <div key={r.repo} className="flex items-center gap-3 p-3 bg-canvas border border-border rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{r.name}</span>
                  <span className="text-[10px] text-muted-foreground">⭐ {r.stars}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{r.description}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">{r.repo}</p>
              </div>
              <button onClick={() => install(r.repo)} disabled={installing === r.repo}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-foreground text-canvas hover:opacity-90 disabled:opacity-50">
                {installing === r.repo ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {lang === 'zh' ? '安装' : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Installed skills */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] text-muted-foreground font-medium">
            {lang === 'zh' ? `已安装 (${skills.length})` : `Installed (${skills.length})`}
          </p>
          <button onClick={loadSkills} className="p-1.5 rounded-lg hover:bg-surface-alt text-muted-foreground">
            <RefreshCw size={12} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="animate-spin text-muted-foreground" size={18} /></div>
        ) : skills.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-6">
            {lang === 'zh' ? '暂无安装的 skill' : 'No skills installed'}
          </p>
        ) : (
          <div className="space-y-2">
            {skills.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-canvas border border-border rounded-xl">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{s.name}</span>
                    {s.status === 'update_available' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600">
                        {lang === 'zh' ? '有更新' : 'Update'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{s.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">{s.repo}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <a href={`https://github.com/${s.repo}`} target="_blank" rel="noopener"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-alt">
                    <ExternalLink size={14} />
                  </a>
                  <button onClick={() => uninstall(s.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
