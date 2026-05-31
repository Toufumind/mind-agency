'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Hash, Users, Activity, Settings, Plus,
  Trash2, X, Bot, Play, Shield, ClipboardList
} from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; autoProcessGroupInvites?: boolean; }; }
interface GroupInfo { name: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [confirmDel, setConfirmDel] = useState('');

  const load = useCallback(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
    fetch('/api/groups/scan').then(r => r.json())
      .then(d => { if (d.groups) setGroups(d.groups.map((g: string) => ({ name: g }))); })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const doDelete = async () => {
    if (!confirmDel) return;
    const [type, name] = confirmDel.split(':');
    try {
      if (type === 'group') await fetch(`/api/groups/${name}`, { method: 'DELETE' });
      else await fetch(`/api/agents?name=${name}`, { method: 'DELETE' });
      if (pathname.includes(`/${name}`)) router.push('/');
    } catch {}
    setConfirmDel('');
    load();
  };

  return (
    <aside className="w-[230px] bg-[#fafafa] border-r border-gray-100 flex flex-col shrink-0 h-screen overflow-hidden">
      {/* Brand */}
      <Link href="/" className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
        <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center">
          <Bot size={14} className="text-white" />
        </div>
        <span className="text-[14px] font-semibold text-gray-900 tracking-tight">Mind Agency</span>
      </Link>

      <nav className="flex-1 py-3 px-2.5 space-y-4 overflow-y-auto">
        {/* Quick actions */}
        <div className="px-1">
          <Link href="/"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
              pathname === '/' ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
            }`}>
            <Activity size={14} />
            Dashboard
          </Link>
        </div>

        {/* Groups */}
        <section>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
              <Hash size={10} /> Teams
            </span>
            <button onClick={() => {/* TODO: create group modal */}}
              className="text-gray-300 hover:text-gray-500 transition-colors">
              <Plus size={13} />
            </button>
          </div>
          <div className="space-y-0.5">
            {groups.map(g => {
              const active = pathname === `/groups/${g.name}`;
              return (
                <div key={g.name} className="group relative flex items-center">
                  <Link href={`/groups/${g.name}`}
                    className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                      active ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                    }`}>
                    <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 shrink-0">#</span>
                    <span className="truncate">{g.name}</span>
                  </Link>
                  <button onClick={() => setConfirmDel(`group:${g.name}`)}
                    className="absolute right-1.5 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Agents */}
        <section>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
              <Users size={10} /> Members
            </span>
            <span className="text-[10px] text-gray-300">{agents.length}</span>
          </div>
          <div className="space-y-0.5">
            {agents.map(a => {
              const active = pathname === `/agents/${a.name}`;
              const isAdmin = a.config?.roles?.includes('admin');
              return (
                <div key={a.name} className="group relative flex items-center">
                  <Link href={`/agents/${a.name}`}
                    className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                      active ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                    }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium shrink-0 ${
                      isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
                    }`}>{a.name[0]}</span>
                    <span className="truncate">{a.name}</span>
                    {isAdmin && <Shield size={9} className="text-gray-400 ml-auto shrink-0" />}
                  </Link>
                  <button onClick={() => setConfirmDel(`agent:${a.name}`)}
                    className="absolute right-1.5 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick tools */}
        <section>
          <span className="px-2 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-widest">Tools</span>
          <div className="space-y-0.5">
            <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-500 hover:text-gray-700 hover:bg-white/50 transition-all">
              <ClipboardList size={13} /> Audit Log
            </Link>
            <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-500 hover:text-gray-700 hover:bg-white/50 transition-all">
              <Play size={13} /> Workflows
            </Link>
          </div>
        </section>
      </nav>

      {/* Status bar */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 text-[10px] text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {agents.length} agents · {groups.length} groups
      </div>

      {/* Confirm delete modal */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setConfirmDel('')}>
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-gray-900">Delete {confirmDel.split(':')[1]}?</h3>
              <button onClick={() => setConfirmDel('')} className="text-gray-300 hover:text-gray-500"><X size={16} /></button>
            </div>
            <p className="text-[13px] text-red-400 mb-4">This removes all data and cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDel('')} className="px-3 py-1.5 text-[12px] text-gray-500 hover:bg-gray-50 rounded-lg">Cancel</button>
              <button onClick={doDelete} className="px-4 py-1.5 text-[12px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
