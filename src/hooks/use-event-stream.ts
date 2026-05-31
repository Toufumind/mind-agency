'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface LiveEvent {
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
  source: string;
  id: string;
}

type EventHandler = (event: LiveEvent) => void;

/** Hook: subscribe to WS event stream, receive live events */
export function useEventStream(opts?: {
  wsUrl?: string;
  eventTypes?: string[];
  scope?: 'events' | 'all';
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const handlersRef = useRef<EventHandler[]>([]);

  const wsUrl = opts?.wsUrl || `ws://localhost:${typeof window !== 'undefined' ? '3003' : '3001'}`;

  const onEvent = useCallback((handler: EventHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter(h => h !== handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempt = 0;

    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          attempt = 0;
          // Subscribe to events
          const filter: { event?: string[] } = {};
          if (opts?.eventTypes?.length) filter.event = opts.eventTypes;
          ws.send(JSON.stringify({
            type: 'subscribe',
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            options: { scope: opts?.scope || 'all' },
          }));
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data as string);
            if (data.type === 'event') {
              const ev: LiveEvent = {
                event: data.event,
                payload: data.payload || {},
                timestamp: data.timestamp || Date.now(),
                source: data.source || 'system',
                id: data.id || '',
              };
              setLastEvent(ev);
              for (const h of handlersRef.current) h(ev);
            }
          } catch {}
        };

        ws.onclose = () => {
          setConnected(false);
          // Reconnect with exponential backoff (max 30s)
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          attempt++;
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onerror = () => { ws.close(); };
      } catch {}
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch {}
    };
  }, [wsUrl]);

  return { connected, lastEvent, onEvent };
}
