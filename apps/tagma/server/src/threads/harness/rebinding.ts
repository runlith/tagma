import { Clock, Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { MachineStore } from '../../platform/contract/service/store.js';
import { ThreadRebinding } from '../contract/service/rebinding.js';
import { NativeStorage } from '../contract/service/engine.js';
import { isTransportRoad, TRANSPORT_ENTRY, type TransportEntry } from '../contract/wire/harness/transportEntry.js';
import { seatKernel } from '../store/seat.js';
import { makeJournaledTransitions } from './journaled.js';
import { ModelChanges } from '../contract/service/modelChanges.js';

export const makeThreadRebinding = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const { writes } = yield* NativeStorage;
  const journaled = yield* makeJournaledTransitions;
  const models = yield* ModelChanges;
  return ThreadRebinding.of({
    writes,
    prepare: Effect.fn('ThreadRebinding.prepare')(function* (threadId, from, seat) {
      const to = seat.transport.adapter;
      if (!isTransportRoad(to)) return yield* new ThreadStorageFailed({ call: 'rebinding.road', cause: `no road named ${to}` });
      const entry: TransportEntry = {
        type: TRANSPORT_ENTRY,
        id: `transport:${crypto.randomUUID()}`,
        from,
        to,
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      };
      return yield* journaled.write(
        threadId,
        () => sealThreadEvents([{ kind: TRANSPORT_ENTRY, payload: { entry } }]),
        (unit) =>
          Effect.mapError(
            models.record(unit, threadId, seat.selection, seatKernel(db, unit, threadId, seat)),
            (cause) => new ThreadStorageFailed({ call: 'rebinding.seat', cause }),
          ),
      );
    }),
  });
});
