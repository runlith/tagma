import { describe, expect, spyOn, test } from 'bun:test';
import { LeaseRuntime, type RunningWork } from './LeaseRuntime.js';

describe('LeaseRuntime', () => {
  test('owner id starts with the configured prefix', () => {
    const lease = new LeaseRuntime({ ownerIdPrefix: 'lease-test' });
    expect(lease.ownerId.startsWith('lease-test-')).toBe(true);
    expect(lease.ownerId.length).toBeGreaterThan('lease-test-'.length);
  });

  test('owner id can be supplied explicitly', () => {
    const lease = new LeaseRuntime({ ownerIdPrefix: 'lease-test', ownerId: 'fixed-owner' });
    expect(lease.ownerId).toBe('fixed-owner');
  });

  test('add / get / has / delete reflect in-flight work', () => {
    const lease = new LeaseRuntime<RunningWork>({ ownerIdPrefix: 'lease-test' });
    const work: RunningWork = { abort: new AbortController(), promise: Promise.resolve() };
    lease.add('task-1', work);

    expect(lease.has('task-1')).toBe(true);
    expect(lease.get('task-1')).toBe(work);
    expect(lease.size()).toBe(1);

    expect(lease.delete('task-1')).toBe(true);
    expect(lease.has('task-1')).toBe(false);
    expect(lease.size()).toBe(0);
  });

  test('rejects a second in-flight owner for the same work id', () => {
    const lease = new LeaseRuntime<RunningWork>({ ownerIdPrefix: 'lease-test' });
    const first: RunningWork = { abort: new AbortController(), promise: Promise.resolve() };
    const second: RunningWork = { abort: new AbortController(), promise: Promise.resolve() };

    lease.add('task-1', first);

    expect(() => lease.add('task-1', second)).toThrow('Work is already tracked: task-1');
    expect(lease.get('task-1')).toBe(first);
  });

  test('dispose aborts each in-flight work and clears heartbeats', async () => {
    const intervals = new Map<number, () => void>();
    let nextInterval = 0;
    const schedule = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      const id = ++nextInterval;
      intervals.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const cancel = spyOn(globalThis, 'clearInterval').mockImplementation((id) => {
      intervals.delete(Number(id));
    });
    const pulse = () => {
      for (const callback of intervals.values()) callback();
    };
    try {
      const lease = new LeaseRuntime<RunningWork>({ ownerIdPrefix: 'lease-test' });
      const aborts: AbortSignal[] = [];
      const heartbeatCalls = { count: 0 };
      const make = (id: string): RunningWork => {
        const abort = new AbortController();
        aborts.push(abort.signal);
        const heartbeat = setInterval(() => {
          heartbeatCalls.count += 1;
        }, 50);
        const promise = new Promise<void>((resolve) => {
          abort.signal.addEventListener('abort', () => resolve());
        });
        const work = { abort, promise, heartbeat };
        lease.add(id, work);
        return work;
      };
      make('a');
      make('b');
      pulse();
      expect(heartbeatCalls.count).toBe(2);

      await lease.dispose('shutdown');

      expect(lease.disposed).toBe(true);
      expect(lease.size()).toBe(0);
      expect(aborts.every((signal) => signal.aborted)).toBe(true);
      const after = heartbeatCalls.count;
      pulse();
      expect(heartbeatCalls.count).toBe(after);
    } finally {
      cancel.mockRestore();
      schedule.mockRestore();
    }
  });

  test('dispose is idempotent', async () => {
    const lease = new LeaseRuntime<RunningWork>({ ownerIdPrefix: 'lease-test' });
    await lease.dispose('once');
    await lease.dispose('again');
    expect(lease.disposed).toBe(true);
  });

  test('disposed is false until dispose runs', () => {
    const lease = new LeaseRuntime<RunningWork>({ ownerIdPrefix: 'lease-test' });
    expect(lease.disposed).toBe(false);
  });
});
