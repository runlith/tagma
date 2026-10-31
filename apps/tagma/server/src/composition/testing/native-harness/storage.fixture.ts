import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../../platform/store/units.js';
import { threadStore } from '../../../native-harness/testing/doubles.js';
import { threadFolder } from '../../../native-harness/testing/fold.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { project } from '../../../projects/testing/doubles.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../composed.js';
import { fixtureMigrations } from '../migrations.js';

const makeStorage = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* makeThreadRecords;
  const threads = yield* threadStore(records, ENTRY_KINDS);
  return { db, units, records, threads, fold: yield* threadFolder(threads), events: yield* sqliteThreadJournal() };
});

export class StorageFixture extends Context.Service<StorageFixture, Effect.Success<typeof makeStorage>>()('testing/StorageFixture') {}

export const storageFixture = Layer.effect(StorageFixture, makeStorage).pipe(
  Layer.provideMerge(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
    ),
  ),
  Layer.provideMerge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
  Layer.merge(BunFileSystem.layer),
);

export const freshStorage = Effect.gen(function* () {
  const storage = yield* StorageFixture;
  yield* storage.units.write('test.reset', (unit) =>
    Effect.gen(function* () {
      yield* unit.run(storage.db.delete(threadRecord()));
      yield* unit.run(storage.db.delete(project()));
    }),
  );
  return storage;
});
