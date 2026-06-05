'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import { BarChart3, TrendingUp, DollarSign, Zap } from 'lucide-react';
import { useT } from '@/components/i18n';

interface CostRow { agent: string; tokensIn: number; tokensOut: number; cost: number; calls: number; }
interface Analytics { activity: any[]; costs: { today:CostRow[]; week:CostRow[]; monthly:CostRow[]; todayTotal:number; weekTotal:number; monthlyTotal:number; totalCalls:number; }; }

export default function AnalyticsPage() {
  const { t } = useT();
  const [data, setData] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<'today'|'week'|'monthly'>('today');
  useEffect(() => { fetch('/api/system/analytics').then(r=>r.json()).then(setData).catch(()=>{}); }, []);

  const rows: CostRow[] = data ? data.costs[period] : [];
  const total = data ? (period==='today'?data.costs.todayTotal:period==='week'?data.costs.weekTotal:data.costs.monthlyTotal) : 0;
  const maxCost = rows.length > 0 ? Math.max(...rows.map(r=>r.cost), 0.01) : 1;

  return (
    <div className="flex h-full bg-canvas"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10">
          <h1 className="text-[18px] font-semibold text-foreground mb-1 flex items-center gap-2"><BarChart3 size={18} className="text-muted-foreground"/> {t('cost_center')}</h1>
          <p className="text-[12px] text-muted-foreground mb-6">{t('token_tracking')}</p>

          {/* Period selector */}
          <div className="flex items-center gap-1.5 mb-6">
            {(['today','week','monthly'] as const).map(p => (
              <button key={p} onClick={()=>setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${period===p?'bg-surface-alt text-foreground':'text-muted hover:text-foreground'}`}>
                {p==='today'?'今日':p==='week'?'本周':'本月'}
              </button>
            ))}
          </div>

          {/* Total card */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-canvas border border-border rounded-2xl p-4"><DollarSign size={14} className="text-success mb-2"/><p className="text-[22px] font-semibold text-foreground">¥{total.toFixed(2)}</p><p className="text-[11px] text-muted-foreground mt-0.5">{t('total_cost')}</p></div>
            <div className="bg-canvas border border-border rounded-2xl p-4"><Zap size={14} className="text-amber-500 mb-2"/><p className="text-[22px] font-semibold text-foreground">{rows.reduce((s,r)=>s+r.tokensIn+r.tokensOut,0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground mt-0.5">{t('total_tokens')}</p></div>
            <div className="bg-canvas border border-border rounded-2xl p-4"><TrendingUp size={14} className="text-info mb-2"/><p className="text-[22px] font-semibold text-foreground">{rows.reduce((s,r)=>s+r.calls,0)}</p><p className="text-[11px] text-muted-foreground mt-0.5">{t('calls')}</p></div>
          </div>

          {/* Per-agent breakdown */}
          <div className="space-y-2">
            {rows.length === 0 && <p className="text-[12px] text-muted-foreground py-8 text-center">暂无数据</p>}
            {rows.map(r => (
              <div key={r.agent} className="bg-canvas border border-border rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-medium text-foreground">{r.agent}</span>
                  <span className="text-[11px] text-muted">{t('calls_count',{n:r.calls})} · ¥{r.cost.toFixed(4)}</span>
                </div>
                <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden">
                  <div className="h-full bg-foreground rounded-full transition-all" style={{width: `${(r.cost/maxCost)*100}%`}}/>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-muted-foreground">{t('input_tokens',{n:r.tokensIn.toLocaleString()})}</span>
                  <span className="text-[9px] text-muted-foreground">{t('output_tokens',{n:r.tokensOut.toLocaleString()})}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
