'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Users, Hash, Trash2, X } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [confirmDel, setConfirmDel] = useState<string>(''); // 'agent:Name' or 'group:Name'

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
      if (type === 'group') {
        await fetch(`/api/groups/${name}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/agents?name=${name}`, { method: 'DELETE' });
      }
      // Navigate away if on deleted page
      if (pathname.includes(`/${name}`)) router.push('/');
    } catch {}
    setConfirmDel('');
    load();
  };

  return (
    <aside className="w-[220px] bg-[#fbfbfa] border-r border-gray-100 flex flex-col shrink-0">
      <Link href="/" className="px-4 py-4 border-b border-gray-100">
        <span className="text-[14px] font-semibold text-gray-900 tracking-tight">Mind Agency</span>
      </Link>

      <nav className="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
        {/* Team — Groups */}
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <Hash size={12} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Team</span>
            <span className="text-[10px] text-gray-300 ml-auto">{groups.length}</span>
          </div>
          <div className="space-y-0.5">
            {groups.map(g => {
              const active = pathname === `/groups/${g.name}`;
              return (
                <div key={g.name} className="group relative flex items-center">
                  <Link href={`/groups/${g.name}`}
                    className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                      active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`}>
                    <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">#</span>
                    <span className="truncate">{g.name}</span>
                  </Link>
                  <button
                    onClick={() => setConfirmDel(`group:${g.name}`)}
                    className="absolute right-1 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete group">
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Members — Agents */}
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <Users size={12} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Members</span>
            <span className="text-[10px] text-gray-300 ml-auto">{agents.length}</span>
          </div>
          <div className="space-y-0.5">
            {agents.map(a => {
              const active = pathname === `/agents/${a.name}`;
              return (
                <div key={a.name} className="group relative flex items-center">
                  <Link href={`/agents/${a.name}`}
                    className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                      active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`}>
                    <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 shrink-0">{a.name[0]}</span>
                    <span className="truncate">{a.name}</span>
                    {a.emailCount > 0 && <span className="text-[10px] text-gray-300 ml-auto">{a.emailCount}</span>}
                  </Link>
                  <button
                    onClick={() => setConfirmDel(`agent:${a.name}`)}
                    className="absolute right-1 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete agent">
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </nav>

      {/* Confirm delete modal */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setConfirmDel('')}>
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-gray-900">Confirm delete</h3>
              <button onClick={() => setConfirmDel('')} className="text-gray-300 hover:text-gray-500"><X size={16} /></button>
            </div>
            <p className="text-[13px] text-gray-500 mb-1">Delete <strong>{confirmDel.split(':')[1]}</strong>?</p>
            <p className="text-[11px] text-red-400 mb-4">This removes all data and cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDel('')} className="px-3 py-1.5 text-[12px] text-gray-500 hover:bg-gray-50 rounded-lg transition-colors">Cancel</button>
              <button onClick={doDelete} className="px-4 py-1.5 text-[12px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
