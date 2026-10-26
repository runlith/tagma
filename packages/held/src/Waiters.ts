import { Deferred, Effect, Exit, type Scope } from 'effect';

export type WaitersDeclaration<K> = {
  readonly name: string;
  readonly owner: string;
  readonly key: (key: K) => string;
};

export type Waiters<K, A, E> = {
  readonly declaration: WaitersDeclaration<K>;
  wait<E2 = never, R = never>(key: K, start?: Effect.Effect<unknown, E2, R>): Effect.Effect<A, E | E2, R>;
  watch(keys: Iterable<K>): Effect.Effect<Effect.Effect<A, E>, never, Scope.Scope>;
  complete(key: K, exit: Exit.Exit<A, E>): number;
  completeAll(exit: Exit.Exit<A, E>): number;
  standing(key?: K): ReadonlyArray<{ readonly key: string; readonly waiters: number }>;
};

type Waiter<A, E> = { readonly cell: Deferred.Deferred<A, E>; readonly ids: readonly string[] };

export const waiters = Effect.fnUntraced(function* <K, A, E>(
  declaration: WaitersDeclaration<K>,
): Effect.fn.Return<Waiters<K, A, E>, never, Scope.Scope> {
  const table = new Map<string, Set<Waiter<A, E>>>();
  let closed = false;

  const leave = (waiter: Waiter<A, E>): void => {
    for (const id of waiter.ids) {
      const standing = table.get(id);
      if (standing === undefined) continue;
      standing.delete(waiter);
      if (standing.size === 0) table.delete(id);
    }
  };

  const enter = (keys: Iterable<K>): Waiter<A, E> => {
    const waiter: Waiter<A, E> = { cell: Deferred.makeUnsafe<A, E>(), ids: [...new Set(Array.from(keys, declaration.key))] };
    if (closed) {
      Deferred.doneUnsafe(waiter.cell, Exit.interrupt());
      return waiter;
    }
    for (const id of waiter.ids) {
      const standing = table.get(id) ?? new Set<Waiter<A, E>>();
      standing.add(waiter);
      table.set(id, standing);
    }
    return waiter;
  };

  const settle = (waiter: Waiter<A, E>, exit: Exit.Exit<A, E>): void => {
    leave(waiter);
    Deferred.doneUnsafe(waiter.cell, exit);
  };

  const awaited = (waiter: Waiter<A, E>): Effect.Effect<A, E> =>
    Deferred.await(waiter.cell).pipe(Effect.onInterrupt(() => Effect.sync(() => settle(waiter, Exit.interrupt()))));

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      const standing = new Set([...table.values()].flatMap((one) => [...one]));
      table.clear();
      for (const waiter of standing) Deferred.doneUnsafe(waiter.cell, Exit.interrupt());
    }),
  );

  const wait = <E2 = never, R = never>(key: K, start?: Effect.Effect<unknown, E2, R>): Effect.Effect<A, E | E2, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (closed) return Effect.interrupt;
        const waiter = enter([key]);
        const started: Effect.Effect<unknown, E2, R> = start ?? Effect.void;
        return restore(Effect.andThen(started, Deferred.await(waiter.cell))).pipe(Effect.ensuring(Effect.sync(() => leave(waiter))));
      }),
    );

  const watch = (keys: Iterable<K>): Effect.Effect<Effect.Effect<A, E>, never, Scope.Scope> =>
    Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => enter(keys)),
        (waiter) => Effect.sync(() => leave(waiter)),
      ),
      awaited,
    );

  const complete = (key: K, exit: Exit.Exit<A, E>): number => {
    const standing = table.get(declaration.key(key));
    if (standing === undefined) return 0;
    const settled = [...standing];
    for (const waiter of settled) settle(waiter, exit);
    return settled.length;
  };

  const completeAll = (exit: Exit.Exit<A, E>): number => {
    const settled = new Set([...table.values()].flatMap((one) => [...one]));
    for (const waiter of settled) settle(waiter, exit);
    return settled.size;
  };

  const standing = (key?: K): ReadonlyArray<{ readonly key: string; readonly waiters: number }> => {
    if (key === undefined) return [...table].map(([id, one]) => ({ key: id, waiters: one.size }));
    const id = declaration.key(key);
    const one = table.get(id);
    return one === undefined ? [] : [{ key: id, waiters: one.size }];
  };

  return { declaration, wait, watch, complete, completeAll, standing };
});
