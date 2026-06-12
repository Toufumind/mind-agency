/**
 * Event Bus Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  AUDIT_DIR: path.join(__dirname, '.test-data', '.audit'),
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
  GROUPS_DIR: path.join(__dirname, '.test-data', 'Groups'),
  MCP_DIR: path.join(__dirname, '..', 'mcp'),
  SRC_DIR: path.join(__dirname, '..', 'src'),
  DATA_DIR: path.join(__dirname, '.test-data'),
  default: path.join(__dirname, '.test-data'),
}));

vi.mock('../src/lib/atomic', () => ({
  atomicWrite: vi.fn(),
}));

vi.mock('../src/lib/ws-embedded', () => ({
  broadcastWs: vi.fn(),
}));

vi.mock('../src/lib/task-queue', () => ({
  enqueueTask: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock('../src/lib/permission-engine', () => ({
  checkToolPermission: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/lib/workflow-checkpoint', () => ({
  saveRunMeta: vi.fn(),
  saveStepCheckpoint: vi.fn(),
  completeRunCheckpoint: vi.fn(),
  appendRunHistory: vi.fn(),
  findIncompleteRuns: vi.fn().mockReturnValue([]),
  cleanupCheckpoints: vi.fn(),
}));

import { EventBus, EventType, createEvent } from '../src/lib/event-bus';

describe('EventBus', () => {
  it('should create EventBus instance', () => {
    const bus = new EventBus();
    expect(bus).toBeDefined();
  });

  it('should emit and receive events', () => {
    const bus = new EventBus();
    let received: any = null;

    bus.subscribe({}, {}, 'test-client', (event) => {
      received = event;
    });

    const event = createEvent(EventType.AGENT_STATUS_CHANGED, { agent: 'alice', status: 'idle' }, 'test');
    bus.emit(event);

    expect(received).toBeTruthy();
    expect(received.event).toBe(EventType.AGENT_STATUS_CHANGED);
  });

  it('should filter events by type', () => {
    const bus = new EventBus();
    const received: any[] = [];

    bus.subscribe({ event: EventType.TASK_CREATED }, {}, 'test-client', (event) => {
      received.push(event);
    });

    bus.emit(createEvent(EventType.TASK_CREATED, { taskId: '1' }, 'test'));
    bus.emit(createEvent(EventType.TASK_COMPLETED, { taskId: '2' }, 'test'));

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe(EventType.TASK_CREATED);
  });

  it('should unsubscribe', () => {
    const bus = new EventBus();
    let count = 0;

    const subId = bus.subscribe({}, {}, 'test-client', () => { count++; });

    bus.emit(createEvent(EventType.AGENT_STATUS_CHANGED, {}, 'test'));
    expect(count).toBe(1);

    bus.unsubscribe(subId);
    bus.emit(createEvent(EventType.AGENT_STATUS_CHANGED, {}, 'test'));
    expect(count).toBe(1); // Should not increase
  });

  it('should cleanup client subscriptions', () => {
    const bus = new EventBus();
    let count = 0;

    bus.subscribe({}, {}, 'client-1', () => { count++; });
    bus.subscribe({}, {}, 'client-1', () => { count++; });
    bus.subscribe({}, {}, 'client-2', () => { count++; });

    bus.emit(createEvent(EventType.AGENT_STATUS_CHANGED, {}, 'test'));
    expect(count).toBe(3);

    bus.cleanupClient('client-1');
    bus.emit(createEvent(EventType.AGENT_STATUS_CHANGED, {}, 'test'));
    expect(count).toBe(4); // Only client-2 receives
  });

  it('should get stats', () => {
    const bus = new EventBus();
    const stats = bus.getStats();
    expect(stats).toBeDefined();
  });

  it('should deduplicate events', () => {
    const bus = new EventBus();
    let count = 0;

    bus.subscribe({}, {}, 'test-client', () => { count++; });

    const event = createEvent(EventType.TASK_CREATED, { taskId: '1' }, 'test');
    bus.emit(event);
    bus.emit(event); // Same ID, should be deduped

    expect(count).toBe(1);
  });
});
