'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Loader2, Power, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';

interface TerminalProps {
  agentName: string;
}

export default function Terminal({ agentName }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up old
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
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
      allowTransparency: false,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    terminalRef.current = term;
    term.open(containerRef.current);

    // Fit addon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    fitAddon.fit();

    // WebGL addon for performance
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch { /* fallback to canvas */ }

    // Connect WebSocket
    connect();

    function connect() {
      setError('');
      setConnected(false);

      if (wsRef.current) { wsRef.current.close(); }

      const wsUrl = `ws://localhost:3001/ws/${agentName}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setConnected(true);
        term.focus();
        fitAddon.fit();
      };

      ws.onmessage = (event) => {
        const data = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data;
        term.write(data, () => {});
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (event.code !== 1000) {
          term.writeln(`\r\n\x1b[31m[Disconnected] Reconnecting in 3s...\x1b[0m`);
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setError('Connection failed');
      };

      // Keyboard input → WS
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Resize
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\x1b[8;${rows};${cols}t`);
        }
      });
    }

    // Resize on window resize
    const onResize = () => {
      try { fitAddon.fit(); } catch {}
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [agentName]);

  // Handle fullscreen class changes
  useEffect(() => {
    const t = terminalRef.current;
    const f = fitAddonRef.current;
    if (!t || !f) return;
    // Delay fit to let DOM update
    setTimeout(() => f.fit(), 150);
  }, [fullscreen]);

  const handleRefresh = () => {
    if (wsRef.current) wsRef.current.close();
    setTimeout(() => {
      if (terminalRef.current) terminalRef.current.clear();
      // 重新连接 — 清除 terminal 缓冲区重建
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setConnected(false);
      if (terminalRef.current) terminalRef.current.reset();
      // 重新触发 useEffect 重建连接
      const old = terminalRef.current;
      if (old) {
        old.dispose();
        terminalRef.current = null;
      }
      // 重建
      if (containerRef.current) {
        const term = new XTerm({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 14,
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
          theme: {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#58a6ff',
            selectionBackground: '#264f78',
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
          scrollback: 5000,
          tabStopWidth: 4,
        });
        terminalRef.current = term;
        term.open(containerRef.current);
        const fitAddon = new FitAddon();
        fitAddonRef.current = fitAddon;
        term.loadAddon(fitAddon);
        fitAddon.fit();
        try { term.loadAddon(new WebglAddon()); } catch {}
        term.onData(data => {
          if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
        });
        const ws = new WebSocket(`ws://localhost:3001/ws/${agentName}`);
        wsRef.current = ws;
        ws.onopen = () => { setConnected(true); term.focus(); fitAddon.fit(); };
        ws.onmessage = (event) => {
          const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
          term.write(data, () => {});
        };
        ws.onclose = () => setConnected(false);
        ws.onerror = () => setError('Connection failed');
      }
    }, 100);
  };

  return (
    <div className={`flex flex-col bg-[#0d1117] ${fullscreen ? 'fixed inset-0 z-50' : 'h-full rounded-lg overflow-hidden border border-gray-700'}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-[12px] font-medium text-gray-200">{agentName}</span>
          </div>
          <span className="text-[11px] text-gray-500 font-mono">claude</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title="Restart terminal"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ padding: '8px 12px' }}
      />

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-t border-gray-800 shrink-0">
        <span className="text-[10px] text-gray-500 font-mono">
          {connected ? '⚡ Connected' : error ? `⚠ ${error}` : '🔄 Connecting...'}
        </span>
        <span className="text-[10px] text-gray-600 font-mono">
          xterm.js · {agentName}
        </span>
      </div>
    </div>
  );
}
