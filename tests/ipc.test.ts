/**
 * IPC Tests
 */

import { describe, it, expect } from 'vitest';
import { IPCStore, IPCLock } from '../src/lib/ipc';

describe('IPCStore', () => {
  it('should store and retrieve value', () => {
    const store = new IPCStore();
    store.set('test-key', { value: 42 });

    const result = store.get<{ value: number }>('test-key');
    expect(result).toEqual({ value: 42 });
  });

  it('should return null for missing key', () => {
    const store = new IPCStore();
    const result = store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete value', () => {
    const store = new IPCStore();
    store.set('test-key', 'value');
    store.delete('test-key');

    const result = store.get('test-key');
    expect(result).toBeNull();
  });

  it('should list keys with prefix', () => {
    const store = new IPCStore();
    store.set('session:alice', { data: 1 });
    store.set('session:bob', { data: 2 });
    store.set('config:alice', { data: 3 });

    const keys = store.keys('session:');
    expect(keys).toContain('session:alice');
    expect(keys).toContain('session:bob');
    expect(keys).not.toContain('config:alice');
  });

  it('should increment value', () => {
    const store = new IPCStore();
    store.set('counter', 10);

    const result = store.increment('counter', 5);
    expect(result).toBe(15);

    const stored = store.get<number>('counter');
    expect(stored).toBe(15);
  });
});

describe('IPCLock', () => {
  it('should acquire and release lock', () => {
    const lock = new IPCLock('test-lock-acquire');

    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);

    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('should not acquire held lock from different owner', () => {
    const lock1 = new IPCLock('test-lock-owner');
    const lock2 = new IPCLock('test-lock-owner');

    expect(lock1.acquire(5000, 'owner-1')).toBe(true);
    expect(lock2.acquire(1000, 'owner-2')).toBe(false);

    lock1.release('owner-1');
  });

  it('should get lock owner', () => {
    const lock = new IPCLock('test-lock-get-owner');

    lock.acquire(5000, 'owner-123');
    expect(lock.getOwner()).toBe('owner-123');

    lock.release('owner-123');
    expect(lock.getOwner()).toBeNull();
  });
});
