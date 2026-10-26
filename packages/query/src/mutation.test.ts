import { QueryClient, notifyManager, onlineManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutation } from './mutation.svelte.js';

notifyManager.setScheduler((callback) => callback());

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

beforeEach(() => {
  onlineManager.setOnline(true);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('mutation', () => {
  it('run() performs the mutation, updates state and returns data', async () => {
    const queryClient = new QueryClient();

    const m = mutation<number, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: async (value, { signal }) => {
        signal.throwIfAborted();
        return value + 1;
      },
    });

    expect(m.status).toBe('idle');
    expect(m.pending).toBe(false);

    const result = await m.run(1);

    expect(result).toBe(2);
    expect(m.data).toBe(2);
    expect(m.error).toBeUndefined();
    expect(m.status).toBe('success');
    expect(m.pending).toBe(false);
  });

  it('preserves object identity between the run() result and data', async () => {
    const queryClient = new QueryClient();
    const value = { nested: { count: 1 } };

    const m = mutation<typeof value, void>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: async () => value,
    });

    const result = await m.run();

    expect(result).toBe(value);
    expect(m.data).toBe(value);
  });

  it('run() resumes a paused mutation after reconnect', async () => {
    const queryClient = new QueryClient();
    const value = { id: 1 };
    const mutator = vi.fn(async () => value);

    const m = mutation<typeof value, void>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator,
    });

    onlineManager.setOnline(false);
    const resultPromise = m.run();

    await vi.waitFor(() => {
      const cachedMutation = queryClient.getMutationCache().getAll()[0];
      expect(cachedMutation?.state.status).toBe('pending');
      expect(cachedMutation?.state.isPaused).toBe(true);
    });
    expect(mutator).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await expect(resultPromise).resolves.toBe(value);
    expect(mutator).toHaveBeenCalledTimes(1);
    expect(m.data).toBe(value);
    expect(m.status).toBe('success');
  });

  it('reset() returns state to idle', async () => {
    const queryClient = new QueryClient();

    const m = mutation<number, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: async (value) => value + 1,
    });

    await m.run(1);
    expect(m.status).toBe('success');
    expect(m.data).toBe(2);

    m.reset();

    expect(m.status).toBe('idle');
    expect(m.data).toBeUndefined();
    expect(m.error).toBeUndefined();
    expect(m.pending).toBe(false);
  });

  it('reset() aborts an active run()', async () => {
    const queryClient = new QueryClient();
    const aborted = vi.fn();
    const started = createDeferred<void>();

    const m = mutation<string, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: (_value, { signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve();
          if (signal.aborted) {
            aborted();
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });

    const resultPromise = m.run('x');
    await started.promise;
    m.reset();
    const result = await resultPromise;

    expect(result).toBeUndefined();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(m.status).toBe('idle');
  });

  it('mutation errors update error and status without throwing by default', async () => {
    const queryClient = new QueryClient();
    const mutator = vi.fn(async () => {
      throw new Error('boom');
    });

    const m = mutation<string, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator,
    });

    const result = await m.run('x');
    expect(result).toBeUndefined();
    expect(mutator).toHaveBeenCalledTimes(1);
    expect(m.status).toBe('error');
    expect(m.pending).toBe(false);
    expect(m.data).toBeUndefined();
    expect(m.error).toBeInstanceOf(Error);
    expect((m.error as Error).message).toBe('boom');
  });

  it('throwOnError throws the mutation error and updates error and status', async () => {
    const queryClient = new QueryClient();
    const mutator = vi.fn(async () => {
      throw new Error('boom');
    });

    const m = mutation<string, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator,
    });

    await expect(m.run('x', { throwOnError: true })).rejects.toThrow('boom');
    expect(mutator).toHaveBeenCalledTimes(1);
    expect(m.status).toBe('error');
    expect(m.pending).toBe(false);
    expect(m.data).toBeUndefined();
    expect(m.error).toBeInstanceOf(Error);
    expect((m.error as Error).message).toBe('boom');
  });

  it('a run() after failure can recover and clear the error', async () => {
    const queryClient = new QueryClient();
    let callIndex = 0;

    const m = mutation<string, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: async (value) => {
        callIndex += 1;
        if (callIndex === 1) throw new Error('boom');
        return `${value}-ok`;
      },
    });

    const r1 = await m.run('x');
    expect(r1).toBeUndefined();
    expect(m.status).toBe('error');
    expect(m.error).toBeInstanceOf(Error);

    const r2 = await m.run('x');
    expect(r2).toBe('x-ok');
    expect(m.status).toBe('success');
    expect(m.error).toBeUndefined();
    expect(m.data).toBe('x-ok');
  });

  it('latest concurrency aborts the previous run()', async () => {
    const queryClient = new QueryClient();
    const aborted = vi.fn();

    const m = mutation<string, string>({
      name: 'Test',
      concurrency: 'latest',
      queryClient,
      scope: Scope.make(),
      mutator: (value, { signal }) =>
        new Promise<string>((resolve, reject) => {
          if (value === 'fast') {
            resolve('fast-ok');
            return;
          }

          if (signal.aborted) {
            aborted();
            reject(new Error('aborted'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });

    const p1 = m.run('slow');
    await Promise.resolve();
    expect(m.pending).toBe(true);
    expect(m.status).toBe('pending');

    const p2 = m.run('fast');
    const r2 = await p2;
    const r1 = await p1;

    expect(r1).toBeUndefined();
    expect(r2).toBe('fast-ok');
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(m.status).toBe('success');
    expect(m.error).toBeUndefined();
    expect(m.data).toBe('fast-ok');
  });

  it('parallel run() calls are not cancelled by default', async () => {
    const queryClient = new QueryClient();
    const slow = createDeferred<string>();
    const fast = createDeferred<string>();
    const aborted = vi.fn();
    const started: string[] = [];

    const m = mutation<string, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      mutator: (value, { signal }) => {
        started.push(value);
        signal.addEventListener('abort', aborted, { once: true });
        return value === 'slow' ? slow.promise : fast.promise;
      },
    });

    const p1 = m.run('slow');
    const p2 = m.run('fast');
    await vi.waitFor(() => expect(started).toEqual(['slow', 'fast']));
    fast.resolve('fast-ok');
    await expect(p2).resolves.toBe('fast-ok');
    expect(m.pending).toBe(true);
    expect(m.status).toBe('pending');

    slow.resolve('slow-ok');
    await expect(p1).resolves.toBe('slow-ok');
    expect(m.pending).toBe(false);
    expect(m.status).toBe('success');
    expect(m.data).toBe('fast-ok');
    expect(aborted).not.toHaveBeenCalled();
  });
});

describe('mutation: scope', () => {
  it('closing the scope aborts an active run() and makes later runs no-ops', async () => {
    const queryClient = new QueryClient();
    const scope = Scope.make();
    const aborted = vi.fn();
    const started = createDeferred<void>();
    const mutator = vi.fn(
      async (_value: string, { signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          started.resolve();
          if (signal.aborted) {
            aborted();
            reject(new Error('aborted'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    );

    const m = mutation<string, string>({ name: 'Test', queryClient, scope, mutator });

    const p1 = m.run('x');
    await started.promise;
    await scope.close();

    await expect(p1).resolves.toBeUndefined();
    expect(aborted).toHaveBeenCalledTimes(1);

    await expect(m.run('x')).resolves.toBeUndefined();
    expect(mutator).toHaveBeenCalledTimes(1);
  });
});
