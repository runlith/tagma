import { Effect, Option, Semaphore } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { ActState } from '../contract/service/transaction.js';
import { lawRevision } from '../store/lawRevision.js';

export function deriveLaw<A, E, R>(build: (projectId: number) => Effect.Effect<A, E, R>) {
  type Projection = { readonly serial: Semaphore.Semaphore; current?: { revision: string; value: A } };
  const stores = new WeakMap<GraphStore['Service'], Map<number, Projection>>();
  return Effect.fn(function* (projectId: number) {
    if (Option.isSome(yield* Effect.serviceOption(ActState))) return yield* build(projectId);
    const store = yield* GraphStore;
    const known = stores.get(store) ?? new Map<number, Projection>();
    stores.set(store, known);
    const projection = known.get(projectId) ?? { serial: Semaphore.makeUnsafe(1) };
    known.set(projectId, projection);
    const revision = yield* lawRevision(store.db, projectId);
    if (projection.current?.revision === revision) return projection.current.value;
    return yield* projection.serial.withPermits(1)(
      Effect.gen(function* () {
        let revision = yield* lawRevision(store.db, projectId);
        while (true) {
          if (projection.current?.revision === revision) return projection.current.value;
          const value = yield* build(projectId);
          const current = yield* lawRevision(store.db, projectId);
          if (current !== revision) {
            revision = current;
            continue;
          }
          projection.current = { revision, value };
          return value;
        }
      }),
    );
  });
}
