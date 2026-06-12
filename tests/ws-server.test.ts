/**
 * WebSocket Server Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventBus } from '../src/lib/event-bus';
import { EmbeddedWebSocketServer } from '../src/lib/ws-server';
import WebSocket from 'ws';

describe('EmbeddedWebSocketServer', () => {
  let bus: EventBus;
  let wsServer: EmbeddedWebSocketServer;
  const TEST_PORT = 15001;

  beforeAll(async () => {
    bus = new EventBus();
    wsServer = new EmbeddedWebSocketServer(bus, TEST_PORT);
    await wsServer.start();
  });

  afterAll(async () => {
    await wsServer.stop();
  });

  it('should start and stop server', () => {
    expect(wsServer.getClientCount()).toBe(0);
  });

  it('should accept connections', async () => {
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

  it('should get client info', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        const clients = wsServer.getClients();
        expect(clients.length).toBe(1);
        expect(clients[0]).toHaveProperty('clientId');
        expect(clients[0]).toHaveProperty('connectedAt');
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });

  it('should broadcast messages', async () => {
    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve, reject) => {
      let connected = 0;
      let received = 0;

      const onMessage = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          connected++;
          if (connected >= 2) {
            const sent = wsServer.broadcast({ type: 'test', message: 'hello' });
            expect(sent).toBe(2);
          }
        } else if (msg.type === 'test') {
          received++;
          if (received >= 2) {
            ws1.close();
            ws2.close();
            resolve();
          }
        }
      };

      ws1.on('message', onMessage);
      ws2.on('message', onMessage);
      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  });
});
