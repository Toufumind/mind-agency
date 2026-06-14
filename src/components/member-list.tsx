'use client';

import { useState } from 'react';
import { Crown, Star, Trash2, ArrowRightLeft, Plus } from 'lucide-react';

// ═══════ Member List Component ═══════
// Extracted from groups/[name]/page.tsx per frontend-ui-engineering skill

interface GroupConfig {
  owner: string;
  admins: string[];
  members?: string[];
}

export function MemberList({
  members, groupConfig, currentUser, isAdmin, isOwner, allAgents,
  onSetAdmin, onRemoveAdmin, onTransfer, onKick, onInvite,
}: {
  members: string[];
  groupConfig: GroupConfig | null;
  currentUser: string;
  isAdmin: boolean;
  isOwner: boolean | undefined;
  allAgents: string[];
  onSetAdmin: (member: string) => void;
  onRemoveAdmin: (member: string) => void;
  onTransfer: (member: string) => void;
  onKick: (member: string) => void;
  onInvite: (agent: string) => void;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const availableAgents = allAgents.filter(a => !members.includes(a));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          成员 ({members.length})
        </p>
        {isAdmin && (
          <button onClick={() => setShowInvite(!showInvite)}
            className="text-[10px] text-muted-foreground hover:text-muted flex items-center gap-0.5">
            <Plus size={10} /> 邀请
          </button>
        )}
      </div>

      {/* Invite panel */}
      {showInvite && (
        <div className="bg-surface-alt rounded-lg p-2 mb-2 space-y-1">
          <p className="text-[10px] text-muted-foreground">选择要邀请的 Agent：</p>
          {availableAgents.map(a => (
            <button key={a} onClick={() => { onInvite(a); setShowInvite(false); }}
              className="w-full text-left text-[12px] px-2 py-1 rounded hover:bg-surface text-foreground flex items-center gap-1.5">
              <Plus size={10} className="text-muted-foreground" /> {a}
            </button>
          ))}
          {availableAgents.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50">没有可邀请的 Agent</p>
          )}
        </div>
      )}

      {/* Member list */}
      <div className="space-y-0.5">
        {members.map(m => {
          const isMOwner = groupConfig?.owner === m;
          const isMAdmin = groupConfig?.admins?.includes(m) && !isMOwner;
          return (
            <div key={m} className="flex items-center justify-between group px-1 py-1 rounded hover:bg-surface-alt">
              <div className="flex items-center gap-2 text-[12px] text-muted min-w-0">
                <span className="w-5 h-5 rounded-full bg-surface-alt flex items-center justify-center text-[8px] font-medium text-muted-foreground shrink-0">
                  {m[0]}
                </span>
                <span className="truncate">{m}</span>
                {isMOwner && <span title="群主"><Crown size={10} className="text-amber-500 shrink-0" /></span>}
                {isMAdmin && <span title="管理员"><Star size={10} className="text-info shrink-0" /></span>}
              </div>
              {isAdmin && m !== currentUser && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isOwner && (
                    <button onClick={() => isMAdmin ? onRemoveAdmin(m) : onSetAdmin(m)}
                      className="p-0.5 rounded hover:bg-surface text-muted-foreground hover:text-muted"
                      title={isMAdmin ? '取消管理' : '设为管理'}>
                      <Star size={10} className={isMAdmin ? 'fill-blue-400' : ''} />
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => onTransfer(m)}
                      className="p-0.5 rounded hover:bg-surface text-muted-foreground hover:text-muted" title="转让群主">
                      <ArrowRightLeft size={10} />
                    </button>
                  )}
                  {m !== groupConfig?.owner && (
                    <button onClick={() => onKick(m)}
                      className="p-0.5 rounded hover:bg-surface text-muted-foreground hover:text-destructive" title="踢出">
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
