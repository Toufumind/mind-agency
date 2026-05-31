'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { EventMessage, SubscribeFilter } from '@/types';

interface WSEvent extends EventMessage {
  type: 'event';
}

interface UseEventBusOptions {
  filter?: SubscribeFilter;
  scope?: 'events' | 'messages' | 'all';
  maxEvents?: number;
}

/**
 * Hook: subscribe to EventBus via WebSocket.
 * Returns the latest events matching the filter, plus connection status.
 */
export function useEventBus(opts: UseEventBusOptions = {}) {
  const { filter, scope = 'events', maxEvents = 100 } = opts;
  const [events, setEvents] = useState<EventMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const filterKey = useRef(JSON.stringify({ filter, scope }));

  useEffect(() => {
    let cleanup = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cleanup) return;
      try {
        const ws = new WebSocket('ws://localhost:3001');
        wsRef.current = ws;

        ws.onopen = () => {
          if (cleanup) { ws.close(); return; }
          setConnected(true);
          // Subscribe to events
          ws.send(JSON.stringify({
            type: 'subscribe',
            filter: filter || undefined,
            options: { scope },
          }));
        };

        ws.onmessage = (ev) => {
          if (cleanup) return;
          try {
            const msg = JSON.parse(ev.data as string);
            if (msg.type === 'subscribed') {
              // subscription confirmed
            } else if (msg.type === 'event') {
              const { type, ...eventMsg } = msg;
              setEvents(prev => {
                const next = [eventMsg as EventMessage, ...prev];
                return next.slice(0, maxEvents);
              });
            } else if (msg.type === 'error') {
              console.warn('[useEventBus] WS error:', msg.code, msg.message);
            }
          } catch {}
        };

        ws.onclose = () => {
          if (cleanup) return;
          setConnected(false);
          // Reconnect after 3s
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          // onclose will fire after this
        };
      } catch {
        // retry
        if (!cleanup) reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      cleanup = true;
      clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey.current]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}

/**
 * Convenience hook: subscribe to a single EventType.
 */
export function useEventType(eventType: string, maxEvents = 50) {
  return useEventBus({
    filter: { event: eventType as any },
    maxEvents,
  });
}
