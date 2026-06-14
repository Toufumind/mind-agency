'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

// ═══════ Chat Commands ═══════
// Extracted from chat-panel for single responsibility

interface Command {
  cmd: string;
  desc: string;
  handler?: (agentName: string) => Promise<string> | string;
}

// Mind Agency slash commands
export const COMMANDS: Command[] = [
  { cmd: '/clear', desc: 'Reset conversation', handler: () => '' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/version', desc: 'Show version info', handler: () => '**Mind Agency** v0.8.0' },
  { cmd: '/status', desc: 'Show session state' },
  { cmd: '/context', desc: 'Show message/token stats' },
  { cmd: '/memory', desc: 'Show loaded rules and session info' },
  { cmd: '/plan', desc: 'Enter plan mode' },
  { cmd: '/tasks', desc: 'Monitor background tasks' },
  { cmd: '/goal', desc: 'Set or review session goals' },
  { cmd: '/agents', desc: 'List configured sub-agents' },
  { cmd: '/group_create', desc: 'Create a new group' },
  { cmd: '/group_list', desc: 'List all groups' },
  { cmd: '/group_send', desc: 'Send message to group' },
  { cmd: '/email_send', desc: 'Send email' },
  { cmd: '/skill_list', desc: 'List available skills' },
  { cmd: '/deploy', desc: 'Deploy agent updates' },
];

export function getHelpText() {
  return COMMANDS.map(c => `- **${c.cmd}** — ${c.desc}`).join('\n');
}

export function getStatusText(agentName: string) {
  return `**Agent:** ${agentName}\n**Status:** online\n**Session:** active`;
}

export function getContextText(agentName: string) {
  return `**Agent:** ${agentName}\n**Session:** active\n**Messages:** (see chat history)`;
}

// ═══════ Command Palette Component ═══════
export function CommandPalette({ onSelect, onClose }: {
  onSelect: (cmd: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [idx, setIdx] = useState(0);
  const filtered = COMMANDS.filter(c => c.cmd.startsWith(filter));

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-canvas border border-border rounded-xl shadow-lg overflow-hidden z-20">
      <div className="px-3 py-2 border-b border-border">
        <input
          value={filter}
          onChange={e => { setFilter(e.target.value); setIdx(0); }}
          placeholder="输入命令..."
          className="w-full text-[13px] bg-transparent outline-none"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'ArrowDown') setIdx(i => Math.min(i + 1, filtered.length - 1));
            if (e.key === 'ArrowUp') setIdx(i => Math.max(i - 1, 0));
            if (e.key === 'Enter' && filtered[idx]) { onSelect(filtered[idx].cmd); onClose(); }
            if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map((cmd, i) => (
          <button key={cmd.cmd}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors
              ${i === idx ? 'bg-surface-alt text-foreground' : 'text-muted hover:bg-surface'}`}
            onClick={() => { onSelect(cmd.cmd); onClose(); }}>
            <ChevronRight size={12} className="text-muted-foreground" />
            <span className="font-mono text-foreground">{cmd.cmd}</span>
            <span className="text-muted-foreground ml-auto">{cmd.desc}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
            没有匹配的命令
          </div>
        )}
      </div>
    </div>
  );
}
