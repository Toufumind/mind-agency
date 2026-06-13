'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * useWebSocket — unified WebSocket hook with auto-reconnect.
 *
 * Replaces 5+ duplicated reconnect patterns across components.
 *
 * Usage:
 *   useWebSocket(`ws://${hostname}:3001`, (data) => {
 *     if (data.type === 'sidebar_refresh') refresh();
 *   });
 */
export function useWebSocket(
  url: string | null,
  onMessage: (data: any) => void,
  options?: { reconnectDelay?: number; enabled?: boolean },
) {
  const wsRef = useRef<WebSocket | null>(null);
  const stoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onMessageRef = useRef(onMessage);
  const reconnectDelay = options?.reconnectDelay ?? 5000;
  const enabled = options?.enabled !== false;

  // Keep callback ref fresh without reconnecting
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled || !url) return;
    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessageRef.current(data);
          } catch (e) {
            console.error('[useWebSocket] parse error:', e);
          }
        };

        ws.onclose = () => {
          if (!stoppedRef.current) {
            timerRef.current = setTimeout(connect, reconnectDelay);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (!stoppedRef.current) {
          timerRef.current = setTimeout(connect, reconnectDelay);
        }
      }
    };

    connect();

    return () => {
      stoppedRef.current = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url, enabled, reconnectDelay]);

  // Send helper
  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }, []);

  return { send, ws: wsRef };
}
