import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import type * as Worker from 'effect/workers/Worker';
import type { TransferListItem } from 'node:worker_threads';
import { PreparedStoreWorker } from '../store/store.js';
import { runSession } from '../store/session.js';
import type { StoreAnswer, StoreRequest } from '../store/wire.js';

export const localStorePreparationLayer = Layer.effect(
  PreparedStoreWorker,
  Effect.gen(function* () {
    const incoming = yield* Queue.unbounded<StoreRequest>();
    const worker: Worker.Worker<StoreAnswer, StoreRequest> = {
      send: (request, transfers) =>
        Effect.sync(() => {
          const sent = structuredClone(request, { transfer: [...(transfers ?? [])] as TransferListItem[] });
          Queue.offerUnsafe(incoming, sent);
        }),
      run: (handler, options) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* options?.onSpawn ?? Effect.void;
            yield* runSession(incoming, (answer) => Effect.asVoid(handler(structuredClone(answer))));
            return yield* Effect.never;
          }),
        ).pipe(Effect.withTracerEnabled(false), Effect.ensuring(Effect.asVoid(Queue.clear(incoming)))),
    };
    return worker;
  }),
);
