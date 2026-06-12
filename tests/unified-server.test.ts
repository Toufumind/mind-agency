/**
 * Unified Server Integration Test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventBus, EventType, createEvent, setEventBus } from '../src/lib/event-bus';
import { EmbeddedWebSocketServer } from '../src/lib/ws-server';
import { ipcStore } from '../src/lib/ipc';
import WebSocket from 'ws';

describe('Unified Server: Embedded WebSocket', () => {
  let bus: EventBus;
  let wsServer: EmbeddedWebSocketServer;
  const TEST_PORT = 13001;

  beforeAll(async () => {
    bus = new EventBus();
    setEventBus(bus);
    wsServer = new EmbeddedWebSocketServer(bus, TEST_PORT);
    await wsServer.start();
  });

  afterAll(async () => {
    await wsServer.stop();
  });

  it('should start WebSocket server', () => {
    expect(wsServer.getClientCount()).toBe(0);

    // Check IPC has server info
    const port = ipcStore.get<number>('ws:server:port');
    expect(port).toBe(TEST_PORT);
  });

  it('should accept WebSocket connections', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        expect(wsServer.getClientCount()).toBe(1);
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });

  it('should receive welcome message', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('connected');
        expect(msg.clientId).toBeDefined();
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });

  it('should handle subscribe and receive events', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout: did not receive event'));
      }, 5000);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'connected') {
          // Subscribe to all events
          ws.send(JSON.stringify({
            type: 'subscribe',
            filter: {},
            options: { scope: 'all' },
          }));
        } else if (msg.type === 'subscribed') {
          // Emit a test event
          bus.emit(createEvent(EventType.AGENT_STATUS_CHANGED, { agent: 'test', status: 'idle' }, 'test'));
        } else if (msg.type === 'event') {
          expect(msg.event).toBe(EventType.AGENT_STATUS_CHANGED);
          expect(msg.payload.agent).toBe('test');
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  it('should handle pong response', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'connected') {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else if (msg.type === 'pong') {
          expect(msg.timestamp).toBeDefined();
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  it('should broadcast to all clients', async () => {
    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      let connected = 0;
      let received = 0;

      const checkDone = () => {
        if (received >= 2) {
          ws1.close();
          ws2.close();
          resolve();
        }
      };

      const handleMessage = (ws: WebSocket) => (data: Buffer) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'connected') {
          connected++;
          if (connected >= 2) {
            // Both connected, broadcast
            const sent = wsServer.broadcast({ type: 'broadcast', message: 'hello' });
            expect(sent).toBe(2);
          }
        } else if (msg.type === 'broadcast') {
          received++;
          checkDone();
        }
      };

      ws1.on('message', handleMessage(ws1));
      ws2.on('message', handleMessage(ws2));
      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  });

  it('should store events in IPC', () => {
    // Emit some events
    bus.emit(createEvent(EventType.TASK_CREATED, { taskId: '1' }, 'test'));
    bus.emit(createEvent(EventType.TASK_COMPLETED, { taskId: '1' }, 'test'));

    // Check IPC
    const lastEvent = ipcStore.get<any>('events:last');
    expect(lastEvent).toBeDefined();
    expect(lastEvent.event).toBe(EventType.TASK_COMPLETED);

    const recentEvents = ipcStore.get<any[]>('events:recent');
    expect(recentEvents).toBeDefined();
    expect(recentEvents!.length).toBeGreaterThan(0);
  });
});
