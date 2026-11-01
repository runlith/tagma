import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../migrations.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { COMMAND_RESULT_SIGNAL, commandSignalId } from '../../../executions/contract/wire/commands.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { OwnWork } from '../../../threads/contract/service/ownWork.js';
import { eventReads, ownWork, threadInbox, threadRows } from '../../../threads/testing/doubles.js';
import { ThreadRows } from '../../../threads/contract/service/rows.js';
import { ENTRY_KINDS } from '../composed.js';

const INSTALLATION = InstallationId.make('owed-rest');

const base = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

layer(base)('owed rest', (it) => {
  it.effect('a team owed the ending of a background command neither rests nor stands rested as a holder until its signal is read', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const birth = (id: string, parent: string | null) =>
        bornThread(db, {
          id,
          ownerId: 'operator',
          agentId: 'tagma',
          parentThreadId: parent,
          spawnRootId: 'lead',
          cacheGroup: 'lead',
          name: parent === null ? null : id,
          authority: THREAD_AUTHORITY_DEFAULT,
        });
      yield* birth('lead', null);
      yield* birth('worker', 'lead');
      const { deliveries } = storesOver(db, INSTALLATION);
      const own = yield* ownWork().pipe(Effect.provideService(ThreadRows, yield* threadRows(ENTRY_KINDS)));
      const reads = yield* eventReads().pipe(Effect.provideService(OwnWork, own));
      const standing = Effect.gen(function* () {
        const holders = yield* reads.holders(['lead', 'worker']);
        return Object.fromEntries(
          yield* Effect.forEach(['lead', 'worker'], (id) =>
            Effect.map(reads.quiet(id), (quiet) => [id, [quiet, holders.get(id)?.standing]]),
          ),
        );
      });
      const resting = { lead: [true, 'rested'], worker: [true, 'rested'] };
      expect(yield* standing).toEqual(resting);

      const execution: ExecutionRef = { installation: INSTALLATION, execution: ExecutionId.make('e2e-run'), incarnation: 1 };
      yield* units.write('testing.oweEnding', (unit) =>
        deliveries.openDelivery(unit, {
          execution,
          thread: ThreadId.make('worker'),
          signalId: commandSignalId(execution, 'call-1'),
          openedAt: 0,
        }),
      );
      const working = { lead: [false, 'working'], worker: [false, 'working'] };
      expect(yield* standing).toEqual(working);

      const signal = commandSignalId(execution, 'call-1');
      yield* units.write('testing.acceptEnding', (unit) =>
        Effect.andThen(
          deliveries.settleDelivery(unit, execution),
          unit.run(
            db.insert(threadInbox()).values({
              id: signal,
              threadId: 'worker',
              sender: { kind: 'host' },
              kind: 'signal',
              body: { type: COMMAND_RESULT_SIGNAL, addressee: 'transport', text: 'A command you left running has ended.' },
              occurredAt: new Date(0),
            }),
          ),
        ),
      );
      expect(yield* standing).toEqual(working);

      yield* units.write('testing.readEnding', (unit) =>
        unit.run(db.update(threadInbox()).set({ state: 'delivered' }).where(eq(threadInbox().id, signal))),
      );
      expect(yield* standing).toEqual(resting);
    }),
  );
});
