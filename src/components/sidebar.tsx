'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Hash, Users, Activity, Bot, Trash2, X, Shield, GitBranch } from 'lucide-react';
import { useSidebarData } from './sidebar-context';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { agents, groups, activity, loading, refresh } = useSidebarData();
  const [confirmDel, setConfirmDel] = useState('');

  const doDelete = async () => {
    if (!confirmDel) return;
    const [type, name] = confirmDel.split(':');
    try {
      if (type === 'group') await fetch(`/api/groups/${name}`, { method: 'DELETE' });
      else await fetch(`/api/agents?name=${name}`, { method: 'DELETE' });
      if (pathname.includes(`/${name}`)) router.push('/');
    } catch {}
    setConfirmDel('');
    refresh();
  };

  return (
    <aside className="w-[220px] bg-[#fafafa] border-r border-gray-100 flex flex-col shrink-0 h-screen overflow-hidden">
      <Link href="/" prefetch className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
        <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center"><Bot size={14} className="text-white" /></div>
        <span className="text-[14px] font-semibold text-gray-900 tracking-tight">Mind Agency</span>
      </Link>

      <nav className="flex-1 py-3 px-2.5 space-y-4 overflow-y-auto">
        <Link href="/" prefetch className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${pathname === '/' ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
          <Activity size={14} /> Dashboard
        </Link>
        <Link href="/workflows" prefetch className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${pathname === '/workflows' ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
          <GitBranch size={14} /> Workflows
        </Link>

        <section>
          <span className="px-2 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Hash size={10} /> Teams</span>
          <div className="space-y-0.5">
            {groups.map(g => {
              const active = pathname === `/groups/${g.name}`;
              return (
                <div key={g.name} className="group relative">
                  <Link href={`/groups/${g.name}`} prefetch className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${active ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
                    <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 shrink-0">#</span>
                    <span className="truncate">{g.name}</span>
                  </Link>
                  <button onClick={() => setConfirmDel(`group:${g.name}`)} className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={10} /></button>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <span className="px-2 mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Users size={10} /> Members</span>
          <div className="space-y-0.5">
            {agents.map(a => {
              const active = pathname === `/agents/${a.name}`;
              const isAdmin = (a as any).config?.roles?.includes('admin');
              return (
                <div key={a.name} className="group relative">
                  <Link href={`/agents/${a.name}`} prefetch className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${active ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-100' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium shrink-0 ${isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{a.name[0]}</span>
                    <span className="truncate">{a.name}</span>
                    {/* Activity pulse */}
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${activity[a.name] ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]' : 'bg-gray-200'}`} title={activity[a.name] ? 'Active' : 'Idle'} />
                    {isAdmin && <Shield size={9} className="text-gray-400 shrink-0" />}
                  </Link>
                  <button onClick={() => setConfirmDel(`agent:${a.name}`)} className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={10} /></button>
                </div>
              );
            })}
          </div>
        </section>
      </nav>

      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 text-[10px] text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {loading ? '...' : `${agents.length} agents · ${groups.length} groups`}
      </div>

      {confirmDel && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setConfirmDel('')}>
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-semibold text-gray-900">Delete {confirmDel.split(':')[1]}?</h3><button onClick={() => setConfirmDel('')} className="text-gray-300 hover:text-gray-500"><X size={16} /></button></div>
            <p className="text-[13px] text-red-400 mb-4">This cannot be undone.</p>
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
