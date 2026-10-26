import { Deferred, Effect, Exit } from 'effect';

type Gate = { holders: number; readonly waiters: Deferred.Deferred<void>[] };

export type KeyedGates = {
  readonly tryAdmit: (id: string) => boolean;
  readonly admit: (id: string) => Effect.Effect<void>;
  readonly release: (id: string) => void;
  readonly standing: (id?: string) => ReadonlyArray<{ readonly key: string; readonly holders: number; readonly waiters: number }>;
};

export const keyedGates = (concurrency: number): KeyedGates => {
  const gates = new Map<string, Gate>();
  const release = (id: string): void => {
    const gate = gates.get(id);
    if (gate === undefined) return;
    gate.holders -= 1;
    while (gate.holders < concurrency && gate.waiters.length > 0) {
      gate.holders += 1;
      Deferred.doneUnsafe(gate.waiters.shift()!, Exit.void);
    }
    if (gate.holders === 0 && gate.waiters.length === 0) gates.delete(id);
  };
  const tryAdmit = (id: string): boolean => {
    const gate = gates.get(id);
    if (gate === undefined) {
      gates.set(id, { holders: 1, waiters: [] });
      return true;
    }
    if (gate.holders < concurrency && gate.waiters.length === 0) {
      gate.holders += 1;
      return true;
    }
    return false;
  };
  const admit = (id: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      let gate = gates.get(id);
      if (gate === undefined) {
        gate = { holders: 0, waiters: [] };
        gates.set(id, gate);
      }
      if (gate.holders < concurrency && gate.waiters.length === 0) {
        gate.holders += 1;
        return Effect.void;
      }
      const turn = Deferred.makeUnsafe<void>();
      const queued = gate;
      queued.waiters.push(turn);
      return Deferred.await(turn).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (Deferred.isDoneUnsafe(turn)) return release(id);
            queued.waiters.splice(queued.waiters.indexOf(turn), 1);
            if (queued.holders === 0 && queued.waiters.length === 0) gates.delete(id);
          }),
        ),
      );
    });
  return {
    tryAdmit,
    admit,
    release,
    standing: (id) => {
      if (id !== undefined) {
        const gate = gates.get(id);
        return gate === undefined ? [] : [{ key: id, holders: gate.holders, waiters: gate.waiters.length }];
      }
      return [...gates].map(([key, gate]) => ({ key, holders: gate.holders, waiters: gate.waiters.length }));
    },
  };
};
