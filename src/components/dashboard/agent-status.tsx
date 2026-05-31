'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Wifi, WifiOff, Shield, Clock, Bot } from 'lucide-react';

interface AgentStatus {
  agent: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  taskId?: string;
  since: number;
}

interface AgentStatusCardsProps {
  events: Array<{ event: string; payload: Record<string, unknown>; timestamp: number; source: string; id?: string }>;
  /** Fallback agent names from REST API */
  knownAgents?: Array<{ name: string; emailCount: number; config?: Record<string, unknown> }>;
}

const STATUS_COLORS: Record<string, { dot: string; bg: string; label: string }> = {
  idle:    { dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]', bg: 'bg-emerald-50', label: 'Idle' },
  busy:    { dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]',    bg: 'bg-amber-50',  label: 'Busy' },
  error:   { dot: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]',      bg: 'bg-red-50',    label: 'Error' },
  offline: { dot: 'bg-gray-300',                                             bg: 'bg-gray-50',   label: 'Offline' },
};

export default function AgentStatusCards({ events, knownAgents = [] }: AgentStatusCardsProps) {
  const [statuses, setStatuses] = useState<Map<string, AgentStatus>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);

  // Parse agent.status.changed events
  useEffect(() => {
    const next = new Map(statuses);
    let changed = false;
    for (const e of events) {
      if (e.event === 'agent.status.changed' && e.payload) {
        const st: AgentStatus = {
          agent: (e.payload.agent as string) || (e.source as string) || '?',
          status: (e.payload.status as AgentStatus['status']) || 'idle',
          taskId: e.payload.taskId as string | undefined,
          since: (e.payload.since as number) || e.timestamp,
        };
        const existing = next.get(st.agent);
        if (!existing || st.since >= existing.since) {
          next.set(st.agent, st);
          changed = true;
        }
      }
      if (e.event === 'ws.connect' || e.event === 'ws.disconnect') {
        setWsConnected(e.event === 'ws.connect');
      }
    }
    if (changed) setStatuses(next);
  }, [events]);

  // Merge known agents from REST (fallback for agents with no status events)
  const allAgents = useMemo(() => {
    const result: Array<{ name: string; status: AgentStatus | undefined; isAdmin: boolean; emailCount: number }> = [];
    const seen = new Set<string>();

    // Agents with status events first
    for (const [name, st] of statuses) {
      seen.add(name);
      const known = knownAgents.find(a => a.name === name);
      result.push({
        name,
        status: st,
        isAdmin: (known?.config as any)?.roles?.includes?.('admin') ?? false,
        emailCount: known?.emailCount ?? 0,
      });
    }

    // Known agents without status events → mark as offline
    for (const a of knownAgents) {
      if (!seen.has(a.name)) {
        result.push({
          name: a.name,
          status: undefined,
          isAdmin: (a.config as any)?.roles?.includes?.('admin') ?? false,
          emailCount: a.emailCount,
        });
      }
    }

    return result;
  }, [statuses, knownAgents]);

  const onlineCount = allAgents.filter(a => a.status?.status && a.status.status !== 'offline').length;

  if (allAgents.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
        <div className="flex items-center gap-2 mb-3">
          <Users size={14} className="text-blue-500" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Agent Status</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Bot size={28} className="text-gray-200 mb-2" />
          <p className="text-[12px] text-gray-400">No agent data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-blue-500" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Agent Status</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {wsConnected ? (
            <Wifi size={11} className="text-emerald-400" />
          ) : (
            <WifiOff size={11} className="text-gray-300" />
          )}
          <span className="text-[10px] text-gray-400 tabular-nums">
            {onlineCount}/{allAgents.length} online
          </span>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {allAgents.map(({ name, status, isAdmin, emailCount }) => {
          const st = status?.status || 'offline';
          const colors = STATUS_COLORS[st] || STATUS_COLORS.offline;
          const idleSec = status ? Math.round((Date.now() - status.since) / 1000) : 0;
          const idleStr = idleSec < 60 ? `${idleSec}s` : idleSec < 3600 ? `${Math.round(idleSec / 60)}m` : `${Math.round(idleSec / 3600)}h`;

          return (
            <div
              key={name}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                st === 'offline' ? 'border-gray-50 bg-gray-50/50' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
              }`}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${
                  isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                  {name[0]}
                </span>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${colors.dot}`} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium text-gray-800">{name}</span>
                  {isAdmin && <Shield size={9} className="text-gray-400" />}
                  {status?.taskId && (
                    <span className="text-[9px] text-gray-400 truncate max-w-[80px]" title={status.taskId}>
                      #{status.taskId.slice(0, 6)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${colors.bg} ${
                    st === 'offline' ? 'text-gray-400' : st === 'error' ? 'text-red-600' : st === 'busy' ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {colors.label}
                  </span>
                  {st !== 'offline' && (
                    <span className="text-[9px] text-gray-300 flex items-center gap-0.5">
                      <Clock size={9} />{idleStr}
                    </span>
                  )}
                  {emailCount > 0 && <span className="text-[9px] text-gray-300">{emailCount} emails</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
