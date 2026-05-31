'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { RefreshCw, Maximize2, Minimize2, Brain, Wrench, FileText, Zap } from 'lucide-react';

type ActivityType = 'thinking' | 'tool' | 'result' | 'idle';

export default function Terminal({ agentName }: { agentName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [activity, setActivity] = useState<ActivityType>('idle');
  const [lastActivity, setLastActivity] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Setup ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clean
    termRef.current?.dispose();
    wsRef.current?.close();

    // Create terminal
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5d7', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
        brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      },
      cols: 100,
      rows: 30,
    });

    termRef.current = term;
    term.open(el);

    // Fit
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // WebGL
    try { term.loadAddon(new WebglAddon()); } catch {}

    // Delay fit
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { fit.fit(); } catch {}
        term.focus();
      });
    });

    // WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>;
    function connectWs() {
      if (wsRef.current) { wsRef.current.close(); }
      setError('');
      setConnected(false);

      const ws = new WebSocket(`ws://localhost:3001/ws/${agentName}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try { fit.fit(); } catch {}
            term.focus();
          });
        });
      };

      ws.onmessage = (event) => {
        const data = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data;
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        try { term.write(data as string, () => {}); } catch {}

        // Activity detection
        clearTimeout(timer.current);
        if (/thinking|Thinking|thought for/i.test(text)) {
          setActivity('thinking');
        } else if (/\b(Read|Write|Edit|Bash|Glob|Grep|WebSearch|WebFetch|Task)\b/.test(text)) {
          setActivity('tool');
          const m = text.match(/\b(Read|Write|Edit|Bash|Glob|Grep|WebSearch|WebFetch|Task)\b/);
          if (m) setLastActivity(m[1]);
        } else if (/[┌└─│]|Result|tool_result/.test(text)) {
          setActivity('result');
        }
        timer.current = setTimeout(() => setActivity('idle'), 2500);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!error) {
          reconnectTimer = setTimeout(connectWs, 2000);
        }
      };

      ws.onerror = () => setError('Connection failed');
    }

    connectWs();

    // Input
    term.onData(data => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
    });

    // Resize
    term.onResize(() => { try { fit.fit(); } catch {} });

    // Cleanup
    return () => {
      clearTimeout(reconnectTimer);
      clearTimeout(timer.current);
      wsRef.current?.close();
      term.dispose();
    };
  }, [agentName]);

  // Handle fullscreen
  useEffect(() => {
    setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 200);
  }, [fullscreen]);

  const badgeIcon = activity === 'thinking' ? Brain : activity === 'tool' ? Wrench : activity === 'result' ? FileText : null;
  const badgeColor = activity === 'thinking' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
    : activity === 'tool' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
    : activity === 'result' ? 'text-green-400 bg-green-500/10 border-green-500/20' : '';

  const BadgeIcon = badgeIcon;

  return (
    <div
      className="flex flex-col bg-[#0d1117] rounded-xl overflow-hidden border border-[#30363d]"
      style={fullscreen
        ? { position: 'fixed', inset: 0, zIndex: 50 }
        : { flex: 1, minHeight: 400, width: '100%' }
      }
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-[#21262d] shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${
            connected ? 'bg-[#3fb950]' : error ? 'bg-[#f85149]' : 'bg-[#d29922]'
          }`} />
          <span className="text-[12px] font-semibold text-[#e6edf3]">{agentName}</span>
          {BadgeIcon && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${badgeColor}`}>
              <BadgeIcon size={10} />
              <span>{lastActivity || activity}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => {
            wsRef.current?.close();
            setTimeout(() => {
              termRef.current?.reset();
              // Will trigger reconnect
            }, 200);
          }}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            title="Restart">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setFullscreen(f => !f)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div style={{ flex: 1, minHeight: 300, width: '100%', overflow: 'hidden', position: 'relative' }}>
        {!connected && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0d1117', color: '#8b949e', fontFamily: 'monospace', fontSize: 13, zIndex: 10,
          }}>
            {error ? `⚠ ${error} — Retrying...` : 'Connecting to agent...'}
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-t border-[#21262d] shrink-0 select-none">
        <span className="text-[10px] text-[#8b949e] font-mono">
          {connected ? 'claude' : error || 'connecting...'}
        </span>
        <span className="text-[10px] text-[#484f58] font-mono">{agentName}</span>
      </div>
    </div>
  );
}
