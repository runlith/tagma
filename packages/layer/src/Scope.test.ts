import { describe, expect, it, vi } from 'vitest';

import { Scope, ScopeAbort } from './Scope.js';

describe('Scope', () => {
  it('starts finalizers newest first, observes every one and reports the ones that throw', async () => {
    const scope = Scope.make('s');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started: string[] = [];
    const finished: string[] = [];

    scope.defer(() => {
      started.push('first');
      finished.push('first');
    });
    scope.defer(async () => {
      started.push('second');
      await Promise.resolve();
      finished.push('second');
    });
    scope.defer(() => {
      started.push('third');
      throw new Error('finalizer blew up');
    });

    await expect(scope.close()).resolves.toBeUndefined();
    expect(started).toEqual(['third', 'second', 'first']);
    expect(finished).toContain('second');
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('refuses a child and an await once closed; a late defer runs its finalizer at once', async () => {
    const scope = Scope.make('s');
    await scope.close();

    const late = vi.fn();
    scope.defer(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(() => scope.rung('session', 'user')).toThrow(ScopeAbort);
    await expect(scope.await(Promise.resolve(1))).rejects.toBeInstanceOf(ScopeAbort);
  });

  it('closing the parent closes the child; a child closed first is closed once and leaves no trace behind', async () => {
    const parent = Scope.make('p');
    const child = parent.rung('c', 'user');
    await parent.close();
    expect(child.closed).toBe(true);

    const survivor = Scope.make('p2');
    const early = survivor.rung('c2', 'user');
    const finalizer = vi.fn();
    early.defer(finalizer);
    await early.close();
    expect(survivor.finalizers).toHaveLength(0);
    await survivor.close();
    expect(finalizer).toHaveBeenCalledTimes(1);
  });

  it('a child with no tier is a lifetime: it inherits the graph and hosts no key', () => {
    const parent = Scope.make('p');
    const graph = {} as NonNullable<Scope['graph']>;
    parent.graph = graph;

    const child = parent.child('lifetime');

    expect(child.tier).toBeUndefined();
    expect(child.graph).toBe(graph);
    expect(child.rung('nested', 'user').graph).toBe(graph);
  });

  it('a command entering through run sees the cancellation and its ScopeAbort goes no further', async () => {
    const scope = Scope.make('s');
    let seen: AbortSignal | undefined;

    const running = scope.run(async (signal) => {
      seen = signal;
      await scope.await(new Promise(() => undefined));
    });

    await scope.close();
    await expect(running).resolves.toBeUndefined();
    expect(seen?.aborted).toBe(true);
  });

  it('run lets a real failure through — only cancellation is the scope its own business', async () => {
    const scope = Scope.make('s');

    await expect(scope.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('a promise that settles after the close still rejects with ScopeAbort', async () => {
    const scope = Scope.make('s');
    let settle: ((value: number) => void) | undefined;
    const awaited = scope.await(
      new Promise<number>((resolve) => {
        settle = resolve;
      }),
    );

    await scope.close();
    settle?.(1);

    await expect(awaited).rejects.toBeInstanceOf(ScopeAbort);
  });

  it('closing twice is one teardown', async () => {
    const scope = Scope.make('s');
    const finalizer = vi.fn();
    scope.defer(finalizer);

    await scope.close();
    await scope.close();

    expect(finalizer).toHaveBeenCalledTimes(1);
  });
});
