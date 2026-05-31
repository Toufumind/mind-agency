'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { RefreshCw, Maximize2, Minimize2, Brain, Wrench, FileText } from 'lucide-react';

export default function Terminal({ agentName }: { agentName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [activity, setActivity] = useState<string>('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    termRef.current?.dispose();
    wsRef.current?.close();

    // ── Terminal setup ──
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13.5,
      fontFamily: '"JetBrains Mono","Fira Code",monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#1f3a5f',
      },
      rows: 30,
      cols: 100,
      allowProposedApi: true,
      scrollback: 5000,
    });
    termRef.current = term;
    term.open(el);

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    requestAnimationFrame(() => { requestAnimationFrame(() => { try { fit.fit(); } catch {} }); });

    // Welcome
    term.writeln('\x1b[38;5;240m╭─ Mind Agency · ' + agentName + ' ─╮\x1b[0m');
    term.writeln('\x1b[38;5;240m│  Connecting to ' + agentName + '...\x1b[0m');
    term.writeln('');

    // ── WebSocket ──
    let buffer = '';
    function connectWs() {
      if (wsRef.current) wsRef.current.close();
      setConnected(false);
      setError('');

      const ws = new WebSocket(`ws://localhost:3001/ws/${agentName}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        term.writeln('\x1b[32m●\x1b[0m Connected to ' + agentName);
        term.writeln('');
        fit.fit();
      };

      ws.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(new Uint8Array(event.data));
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);

            if (obj.type === 'system' && obj.subtype === 'init') {
              term.writeln(`\x1b[38;5;240m  ${obj.model} · ${obj.claude_code_version}\x1b[0m`);
            }

            // Assistant message with content
            if (obj.type === 'assistant' && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === 'thinking' && block.thinking) {
                  setActivity('Thinking');
                  term.writeln(`\x1b[38;5;99m  ⬤ Thinking...\x1b[0m`);
                  const thoughts = block.thinking.split('\n');
                  for (const t of thoughts) {
                    term.writeln(`\x1b[38;5;240m  │ ${t.slice(0, 200)}\x1b[0m`);
                  }
                  setActivity('');
                }
                if (block.type === 'tool_use') {
                  setActivity(block.name);
                  term.writeln(`\x1b[38;5;75m  ⚙ ${block.name}\x1b[0m ${JSON.stringify(block.input || {}).slice(0, 200)}`);
                }
                if (block.type === 'text' && block.text) {
                  setActivity('');
                  term.writeln('');
                  const words = block.text.split('\n');
                  for (const w of words) {
                    term.writeln(`  ${w}`);
                  }
                  term.writeln('');
                }
              }
            }

            // User message with tool results
            if (obj.type === 'user' && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === 'tool_result') {
                  setActivity('');
                  const out = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
                  const truncated = out.length > 500 ? out.slice(0, 500) + '...' : out;
                  term.writeln(`\x1b[38;5;113m  ✓ Result:\x1b[0m`);
                  for (const r of truncated.split('\n').slice(0, 3)) {
                    term.writeln(`\x1b[38;5;240m  │ ${r}\x1b[0m`);
                  }
                }
              }
            }

            // Final result
            if (obj.type === 'result' && obj.subtype === 'success' && obj.result) {
              setActivity('');
              // Result already shown in previous text blocks
            }

            if (obj.type === 'result' && obj.subtype === 'error') {
              setActivity('');
              term.writeln(`\x1b[31m  ✕ Error: ${obj.error || 'Unknown'}\x1b[0m`);
            }
          } catch {
            // Non-JSON line: display as raw text
            term.write(line + '\r\n');
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        term.writeln('\x1b[33m  ⬤ Disconnected · reconnecting...\x1b[0m');
        setTimeout(connectWs, 2000);
      };

      ws.onerror = () => setError('Connection failed');
    }

    connectWs();

    // Cleanup
    return () => {
      wsRef.current?.close();
      term.dispose();
    };
  }, [agentName]);

  // Fullscreen resize
  useEffect(() => {
    setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 200);
  }, [fullscreen]);

  // Send message to claude
  const sendMessage = () => {
    const text = inputRef.current?.value?.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(text);
    termRef.current?.writeln(`\x1b[36m▸\x1b[0m ${text}`);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      className="flex flex-col bg-[#0d1117] rounded-xl overflow-hidden border border-[#30363d]"
      style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 50 } : { flex: 1, minHeight: 400, width: '100%' }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#21262d] shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#3fb950]' : error ? 'bg-[#f85149]' : 'bg-[#d29922]'}`} />
          <span className="text-[12px] font-semibold text-[#e6edf3]">{agentName}</span>
          {activity && (
            <span className="text-[10px] text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded-full">{activity}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => {
            wsRef.current?.close();
            setTimeout(() => { termRef.current?.clear(); termRef.current?.writeln('\x1b[38;5;240mRestarting...\x1b[0m'); }, 200);
          }}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setFullscreen(f => !f)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]">
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 300, width: '100%' }} />

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#161b22] border-t border-[#21262d] shrink-0">
        <input
          ref={inputRef as any}
          type="text"
          placeholder={`Message ${agentName}...`}
          className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-[13px] text-[#e6edf3] font-mono outline-none focus:border-[#58a6ff] placeholder:text-[#484f58]"
          onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
        />
        <button
          onClick={sendMessage}
          className="px-3 py-1.5 bg-[#21262d] text-[#e6edf3] text-[12px] font-medium rounded-md hover:bg-[#30363d] transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
