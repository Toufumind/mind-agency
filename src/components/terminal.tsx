'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  RefreshCw, Maximize2, Minimize2,
  Brain, Wrench, FileText, Zap,
} from 'lucide-react';

interface TerminalProps {
  agentName: string;
}

// ── Activity overlay types ──
type ActivityType = 'thinking' | 'tool' | 'result' | 'idle';

function Terminal({ agentName }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [activity, setActivity] = useState<ActivityType>('idle');
  const [lastActivity, setLastActivity] = useState('');
  const activityTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Connection logic ──
  const connect = useCallback(() => {
    if (!containerRef.current) return;
    setError('');
    setConnected(false);
    setActivity('idle');

    // Clean old
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13.5,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        selectionForeground: '#e6edf3',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5d7',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
      scrollback: 8000,
      tabStopWidth: 2,
      convertEol: true,
      cols: 100,
      rows: 30,
    });

    termRef.current = term;
    term.open(containerRef.current);

    const fitAddon = new FitAddon();
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);

    try { term.loadAddon(new WebglAddon()); } catch { /* canvas fallback */ }

    // Connect
    const ws = new WebSocket(`ws://localhost:3001/ws/${agentName}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      fitAddon.fit();
      setTimeout(() => term.focus(), 100);
    };

    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data;

      term.write(data as string, () => {});

      // ── Activity detection ──
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      clearTimeout(activityTimer.current);

      if (text.includes('thinking') || text.includes('Thinking') || text.includes('thought for')) {
        setActivity('thinking');
        setLastActivity('Thinking');
      } else if (text.includes('Tool') || text.includes('tool_use') || text.includes('Read') || text.includes('Write') || text.includes('Bash') || text.includes('Glob') || text.includes('Grep') || text.includes('Edit') || text.includes('WebSearch') || /\b[A-Z][a-z]+\(/.test(text)) {
        setActivity('tool');
        // Extract tool name
        const m = text.match(/\b(Read|Write|Edit|Bash|Glob|Grep|WebSearch|WebFetch|Task)\b/);
        if (m) setLastActivity(m[1]);
      } else if (text.includes('─') || text.includes('│') || text.includes('┌') || text.includes('└')) {
        // Tool result display
        setActivity('result');
      } else {
        setActivity('idle');
      }

      activityTimer.current = setTimeout(() => setActivity('idle'), 2000);
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError('Connection failed');

    // Input
    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Resize
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\x1b[8;${rows};${cols}t`);
      }
      fitAddon.fit();
    });
  }, [agentName]);

  useEffect(() => {
    connect();
    const onResize = () => { try { fitRef.current?.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, [connect]);

  // Handle fullscreen resize
  useEffect(() => {
    setTimeout(() => fitRef.current?.fit(), 200);
  }, [fullscreen]);

  const handleRefresh = () => {
    if (wsRef.current) wsRef.current.close();
    connect();
  };

  const activityBadge = () => {
    switch (activity) {
      case 'thinking': return { icon: Brain, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', label: lastActivity || 'Thinking' };
      case 'tool': return { icon: Wrench, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: lastActivity || 'Tool use' };
      case 'result': return { icon: FileText, color: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'Result' };
      default: return null;
    }
  };

  const badge = activityBadge();

  return (
    <div className={`flex flex-col bg-[#0d1117] ${fullscreen ? 'fixed inset-0 z-50' : 'h-full rounded-xl overflow-hidden border border-[#30363d] shadow-2xl'}`}>
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-[#21262d] shrink-0 select-none">
        <div className="flex items-center gap-3">
          {/* Connection dot */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              connected ? 'bg-[#3fb950] shadow-[0_0_6px_rgba(63,185,80,0.5)]' : error ? 'bg-[#f85149]' : 'bg-[#d29922]'
            }`} />
            <span className="text-[12px] font-semibold text-[#e6edf3] tracking-tight">{agentName}</span>
          </div>

          {/* Activity indicator */}
          {badge && badge.icon && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.color} animate-pulse`}>
              <badge.icon size={10} />
              <span>{badge.label}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={handleRefresh}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            title="Restart">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setFullscreen(!fullscreen)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── Terminal ── */}
      <div ref={containerRef} className="flex-1 min-h-0 px-1.5 py-1" />

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-t border-[#21262d] shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#8b949e] font-mono">
            {connected ? 'claude' : error || 'connecting...'}
          </span>
          {connected && (
            <span className="text-[10px] text-[#484f58]">
              <Zap size={9} className="inline mr-0.5" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[#484f58] font-mono">
          <span>TERM=xterm-256color</span>
          <span className="text-[#21262d]">│</span>
          <span>{agentName}</span>
        </div>
      </div>
    </div>
  );
}

export default Terminal;
