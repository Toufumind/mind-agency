'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import { BarChart3, TrendingUp, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface LearningRecord {
  id: string; group: string; workflow: string; stepId: string;
  agent: string; evaluation: { quality: number; completeness: number; clarity: number; actionability: number; total: number; feedback: string; verdict: string; };
  outputSnippet: string; timestamp: string;
}

interface Summary { avgTotal: number; count: number; approved: number; needsRevision: number; approvalRate?: number; }

export default function LearningPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [summary, setSummary] = useState<Summary>({ avgTotal: 0, count: 0, approved: 0, needsRevision: 0 });
  const [loading, setLoading] = useState(false);

  const loadGroups = useCallback(() => {
    fetch('/api/learning').then(r => r.json()).then(d => {
      const g = d.groups || [];
      setGroups(g);
      if (g.length > 0 && !selectedGroup) setSelectedGroup(g[0]);
    }).catch(() => {});
  }, []);

  const loadRecords = useCallback(() => {
    if (!selectedGroup) return;
    setLoading(true);
    fetch(`/api/learning?group=${selectedGroup}&limit=50`).then(r => r.json()).then(d => {
      setRecords(d.records || []);
      setSummary(d.summary || { avgTotal: 0, count: 0, approved: 0, needsRevision: 0 });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedGroup]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const scoreColor = (score: number) => {
    if (score >= 32) return 'text-success';
    if (score >= 24) return 'text-amber-600';
    return 'text-destructive';
  };

  return (
    <div className="flex h-full bg-canvas overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5">
              <BarChart3 size={20} className="text-info" />
              <h1 className="text-[16px] font-semibold text-foreground">学习记录</h1>
            </div>
            <div className="flex items-center gap-2">
              <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}
                className="px-3 py-1.5 text-[12px] bg-surface border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring">
                {groups.length === 0 && <option value="">无群组</option>}
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <button onClick={loadRecords} className="p-1.5 rounded-lg hover:bg-surface transition-colors">
                <RefreshCw size={14} className="text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            <div className="bg-canvas border border-border rounded-2xl p-4">
              <p className="text-[10px] text-muted-foreground mb-1">总记录</p>
              <p className="text-[20px] font-bold text-foreground">{summary.count}</p>
            </div>
            <div className="bg-canvas border border-border rounded-2xl p-4">
              <p className="text-[10px] text-muted-foreground mb-1">平均分</p>
              <p className={`text-[20px] font-bold ${scoreColor(summary.avgTotal)}`}>{summary.avgTotal}<span className="text-[11px] text-muted-foreground font-normal">/40</span></p>
            </div>
            <div className="bg-canvas border border-border rounded-2xl p-4">
              <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle size={10} className="text-success"/> 通过</p>
              <p className="text-[20px] font-bold text-success">{summary.approved}</p>
            </div>
            <div className="bg-canvas border border-border rounded-2xl p-4">
              <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><XCircle size={10} className="text-destructive"/> 需修改</p>
              <p className="text-[20px] font-bold text-destructive">{summary.needsRevision}</p>
            </div>
          </div>

          {/* Score distribution bar */}
          {summary.count > 0 && (
            <div className="mb-8 bg-canvas border border-border rounded-2xl p-4">
              <p className="text-[11px] text-muted-foreground mb-2">通过率</p>
              <div className="w-full h-3 bg-surface rounded-full overflow-hidden flex">
                <div className="bg-success h-full transition-all" style={{ width: `${(summary.approved / summary.count) * 100}%` }} />
                <div className="bg-destructive h-full transition-all" style={{ width: `${(summary.needsRevision / summary.count) * 100}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-success">{Math.round((summary.approved / summary.count) * 100)}% 通过</span>
                <span className="text-[10px] text-destructive">{Math.round((summary.needsRevision / summary.count) * 100)}% 需修改</span>
              </div>
            </div>
          )}

          {/* Records list */}
          <div>
            <h2 className="text-[12px] font-medium text-muted mb-3">最近记录</h2>
            {loading ? (
              <p className="text-[12px] text-muted-foreground text-center py-8">加载中...</p>
            ) : records.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-8">暂无记录</p>
            ) : (
              <div className="space-y-2">
                {records.map(r => (
                  <div key={r.id} className="bg-canvas border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          r.evaluation?.verdict === 'APPROVED' ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'
                        }`}>{r.evaluation?.verdict === 'APPROVED' ? '通过' : '需修改'}</span>
                        <span className="text-[12px] font-medium text-foreground">{r.agent}</span>
                        <span className="text-[10px] text-muted-foreground">· {r.workflow}/{r.stepId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] font-bold font-mono ${scoreColor(r.evaluation?.total || 0)}`}>
                          {r.evaluation?.total || 0}<span className="text-[10px] text-muted-foreground font-normal">/40</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">{new Date(r.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {/* Score breakdown */}
                    <div className="flex gap-3 mb-2">
                      {['quality', 'completeness', 'clarity', 'actionability'].map(dim => (
                        <div key={dim} className="flex items-center gap-1 text-[9px]">
                          <span className="text-muted-foreground">{dim === 'quality' ? '质量' : dim === 'completeness' ? '完整' : dim === 'clarity' ? '清晰' : '可执行'}</span>
                          <span className="font-mono text-foreground">{(r.evaluation as any)?.[dim] || 0}</span>
                        </div>
                      ))}
                    </div>
                    {r.evaluation?.feedback && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{r.evaluation.feedback}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
