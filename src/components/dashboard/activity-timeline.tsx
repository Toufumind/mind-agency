'use client';

import { useMemo } from 'react';
import { Activity, MessageCircle, CheckCircle, AlertCircle, Mail, Zap, UserPlus, Wifi, Play, Clock, ArrowRight } from 'lucide-react';

interface ActivityTimelineProps {
  events: Array<{ event: string; payload: Record<string, unknown>; timestamp: number; source: string; id?: string }>;
}

interface TimelineItem {
  id: string;
  event: string;
  label: string;
  detail: string;
  timestamp: number;
  source: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

const EVENT_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  'message.sent':           { label: 'Message',    icon: <MessageCircle size={11} />, color: 'text-blue-500',   bg: 'bg-blue-50' },
  'message.mention':        { label: 'Mention',    icon: <MessageCircle size={11} />, color: 'text-violet-500', bg: 'bg-violet-50' },
  'task.created':           { label: 'Task New',   icon: <Play size={11} />,          color: 'text-green-500',  bg: 'bg-green-50' },
  'task.assigned':          { label: 'Assigned',   icon: <UserPlus size={11} />,      color: 'text-teal-500',   bg: 'bg-teal-50' },
  'task.in_progress':       { label: 'In Progress',icon: <Play size={11} />,          color: 'text-amber-500',  bg: 'bg-amber-50' },
  'task.completed':         { label: 'Completed',  icon: <CheckCircle size={11} />,   color: 'text-emerald-500',bg: 'bg-emerald-50' },
  'task.blocked':           { label: 'Blocked',    icon: <AlertCircle size={11} />,   color: 'text-red-500',    bg: 'bg-red-50' },
  'task.review_requested':  { label: 'Review Req', icon: <Mail size={11} />,          color: 'text-indigo-500', bg: 'bg-indigo-50' },
  'task.review_completed':  { label: 'Review Done',icon: <CheckCircle size={11} />,   color: 'text-cyan-500',   bg: 'bg-cyan-50' },
  'agent.status.changed':   { label: 'Status',     icon: <Activity size={11} />,      color: 'text-blue-500',   bg: 'bg-blue-50' },
  'agent.error':            { label: 'Agent Error',icon: <AlertCircle size={11} />,   color: 'text-red-500',    bg: 'bg-red-50' },
  'poll.result':            { label: 'Poll',       icon: <Zap size={11} />,           color: 'text-amber-500',  bg: 'bg-amber-50' },
  'poll.error':             { label: 'Poll Err',   icon: <AlertCircle size={11} />,   color: 'text-red-500',    bg: 'bg-red-50' },
  'ws.connect':             { label: 'Connected',  icon: <Wifi size={11} />,          color: 'text-emerald-500',bg: 'bg-emerald-50' },
  'ws.disconnect':          { label: 'Disconnected',icon: <Wifi size={11} />,         color: 'text-gray-400',   bg: 'bg-gray-50' },
  'email.received':         { label: 'Email In',   icon: <Mail size={11} />,          color: 'text-purple-500', bg: 'bg-purple-50' },
  'email.sent':             { label: 'Email Out',  icon: <Mail size={11} />,          color: 'text-fuchsia-500',bg: 'bg-fuchsia-50' },
};

function buildDetail(event: string, payload: Record<string, unknown>, source: string): string {
  switch (event) {
    case 'message.sent':
      return `${source} → #${payload.group || '?'}${payload.mentions && Array.isArray(payload.mentions) && payload.mentions.length > 0 ? ` @${(payload.mentions as string[]).join(', ')}` : ''}`;
    case 'message.mention':
      return `${source} mentioned ${payload.mentioned || '?'} in #${payload.group || '?'}`;
    case 'task.assigned':
      return `${payload.title || payload.taskId || '?'} → ${payload.to || source}`;
    case 'task.completed':
      return `${payload.title || payload.taskId || '?'} by ${payload.by || source}`;
    case 'task.blocked':
      return `${payload.title || payload.taskId || '?'} blocked: ${payload.reason || 'unknown'}`;
    case 'task.review_completed':
      return `${payload.title || payload.taskId || '?'} — ${payload.verdict || '?'}`;
    case 'agent.status.changed':
      return `${payload.agent || source} → ${payload.status || '?'}`;
    case 'agent.error':
      return `${payload.agent || source}: ${(payload.message as string)?.slice(0, 60) || payload.code || 'error'}`;
    case 'poll.result':
      return `${source}: ${payload.triggered} triggered, ${payload.polled} polled`;
    case 'ws.connect':
      return `client connected`;
    case 'ws.disconnect':
      return `client disconnected (${payload.code || '?'})`;
    case 'email.received':
      return `${payload.subject || '?'} from ${payload.from || '?'}`;
    case 'email.sent':
      return `${payload.subject || '?'} to ${payload.to || '?'}`;
    default:
      return `${source} — ${event}`;
  }
}

export default function ActivityTimeline({ events }: ActivityTimelineProps) {
  const items = useMemo<TimelineItem[]>(() => {
    return events.slice(0, 50).map(e => {
      const meta = EVENT_META[e.event] || { label: e.event, icon: <ArrowRight size={11} />, color: 'text-gray-400', bg: 'bg-gray-50' };
      return {
        id: e.id || `${e.timestamp}-${e.event}`,
        event: e.event,
        label: meta.label,
        detail: buildDetail(e.event, e.payload, e.source),
        timestamp: e.timestamp,
        source: e.source,
        icon: meta.icon,
        color: meta.color,
        bg: meta.bg,
      };
    });
  }, [events]);

  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-gray-400" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Activity</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Clock size={28} className="text-gray-200 mb-2" />
          <p className="text-[12px] text-gray-400">Waiting for events</p>
          <p className="text-[10px] text-gray-300 mt-1">Real-time activity appears here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-gray-400" />
          <h3 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest">Activity</h3>
        </div>
        <span className="text-[10px] text-gray-400">{items.length} events</span>
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {items.map((item, i) => (
          <div
            key={item.id || i}
            className="flex items-start gap-3 px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
          >
            {/* Icon */}
            <div className={`w-6 h-6 rounded-lg ${item.bg} flex items-center justify-center shrink-0 mt-0.5`}>
              <span className={item.color}>{item.icon}</span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-gray-700">{item.label}</span>
                <span className="text-[10px] text-gray-400 truncate">{item.detail}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] text-gray-400 font-mono tabular-nums">
                  {new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="text-[9px] text-gray-300">{item.source}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
