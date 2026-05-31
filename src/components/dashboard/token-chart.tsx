'use client';

import { useEffect, useState, useMemo } from 'react';
import { Zap, TrendingUp } from 'lucide-react';

interface TokenPoint {
  agent: string;
  timestamp: number;
  triggered: number;
  polled: number;
}

interface TokenChartProps {
  events: Array<{ event: string; payload: Record<string, unknown>; timestamp: number; source: string; id?: string }>;
}

/** Simple bar chart: last 20 poll.result events → per-agent trigger count */
export default function TokenChart({ events }: TokenChartProps) {
  const [points, setPoints] = useState<TokenPoint[]>([]);

  useEffect(() => {
    // Parse poll.result events out of the stream
    const parsed: TokenPoint[] = [];
    for (const e of events) {
      if (e.event === 'poll.result' && e.payload) {
        parsed.push({
          agent: (e.payload.agent as string) || '?',
          timestamp: e.timestamp,
          triggered: (e.payload.triggered as number) ?? 0,
          polled: (e.payload.polled as number) ?? 0,
        });
      }
    }
    setPoints(parsed.slice(0, 20).reverse()); // chronological
  }, [events]);

  // Aggregate by agent
  const agentBuckets = useMemo(() => {
    const map = new Map<string, { triggered: number; polled: number; count: number }>();
    for (const p of points) {
      const b = map.get(p.agent) || { triggered: 0, polled: 0, count: 0 };
      b.triggered += p.triggered;
      b.polled += p.polled;
      b.count += 1;
      map.set(p.agent, b);
    }
    return [...map.entries()].sort((a, b) => b[1].triggered - a[1].triggered);
  }, [points]);

  const maxTriggered = Math.max(1, ...agentBuckets.map(([, v]) => v.triggered));

  if (points.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-amber-500" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Token Usage</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <TrendingUp size={28} className="text-gray-200 mb-2" />
          <p className="text-[12px] text-gray-400">Awaiting poll data</p>
          <p className="text-[10px] text-gray-300 mt-1">Events appear here after agents poll</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-amber-500" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Token Usage</h3>
        </div>
        <span className="text-[10px] text-gray-400">{points.length} polls</span>
      </div>

      {/* Per-agent bars */}
      <div className="space-y-2.5">
        {agentBuckets.map(([agent, bucket]) => {
          const pct = Math.round((bucket.triggered / maxTriggered) * 100);
          return (
            <div key={agent} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-gray-700">{agent}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {bucket.triggered} triggered / {bucket.polled} polled
                </span>
              </div>
              <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: pct > 66
                      ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                      : pct > 33
                      ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                      : 'linear-gradient(90deg, #fcd34d, #fbbf24)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Timeline sparkline */}
      {points.length >= 3 && (
        <div className="mt-4 pt-3 border-t border-gray-50">
          <div className="flex items-end gap-[2px] h-10">
            {points.map((p, i) => {
              const h = Math.max(4, Math.round((p.triggered / Math.max(1, ...points.map(x => x.triggered))) * 40));
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm bg-amber-200 hover:bg-amber-400 transition-colors cursor-default"
                  style={{ height: `${h}px` }}
                  title={`${p.agent}: ${p.triggered} @ ${new Date(p.timestamp).toLocaleTimeString()}`}
                />
              );
            })}
          </div>
          <p className="text-[9px] text-gray-300 mt-1 text-right">per-poll triggers →</p>
        </div>
      )}
    </div>
  );
}
