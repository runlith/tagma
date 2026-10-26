import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { project } from '../../../projects/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { threadTargetOperation } from '../../../threads/testing/doubles.js';
import { threadTargetOperationStore, isThreadTargetStorageFailed, asThreadTargetOperationNew } from '../../../threads/testing/doubles.js';
import { MachineStore, type StoreDb, type StoreFailure } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
);

const owned = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return { db, units, operations: yield* threadTargetOperationStore() };
});

const registerProject = Effect.fn('testing.registerProject')(function* (db: StoreDb<'machine'>, name: string) {
  const row = yield* db
    .insert(project())
    .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project().id })
    .get();
  if (row === undefined) return yield* Effect.die(new Error('the test project was not registered'));
  return row.id;
});

const born = (db: StoreDb<'machine'>, id: string): Effect.Effect<void, StoreFailure> =>
  bornThread(db, {
    id,
    ownerId: 'operator',
    agentId: 'tagma',
    spawnRootId: id,
    cacheGroup: id,
    authority: { mode: 'trust', bypassFrom: null },
  });

const move = (over: Partial<ReturnType<typeof asThreadTargetOperationNew>> & { projectId: number }) =>
  asThreadTargetOperationNew({
    threadId: 't1',
    operationKey: 'op-1',
    payloadDigest: 'digest-1',
    rootId: 'root-1',
    locationRevision: 3,
    expectedSelectionRevision: null,
    selectionRevision: 3,
    expectedGeneration: null,
    fromGeneration: null,
    creationOperationId: null,
    runId: null,
    status: 'pending',
    ...over,
  });

it.live('a recorded move round-trips whole: values preserved, nothing normalized', () =>
  Effect.provide(
    Effect.gen(function* () {
      const held = yield* owned;
      const projectId = yield* registerProject(held.db, 'roundtrip');
      yield* born(held.db, 't1');

      const inserted = yield* held.units.write('ThreadTargetOperationStore.inserted', (unit) =>
        held.operations.insert(move({ projectId }), unit),
      );
      const read = yield* held.units.read((unit) => held.operations.of('t1', 'op-1', unit));

      expect(read).toEqual(inserted);
      expect(read).toMatchObject({
        threadId: 't1',
        operationKey: 'op-1',
        projectId,
        payloadDigest: 'digest-1',
        rootId: 'root-1',
        locationRevision: 3,
        selectionRevision: 3,
        status: 'pending',
        generation: null,
        detail: null,
      });
    }),
    storage,
  ),
);

it.live('a corrupt row fails loud as a storage failure instead of arriving typed', () =>
  Effect.provide(
    Effect.gen(function* () {
      const held = yield* owned;
      yield* registerProject(held.db, 'corrupt');
      yield* born(held.db, 't1');

      yield* Effect.asVoid(
        held.db.insert(threadTargetOperation()).values({
          threadId: 't1',
          operationKey: 'op-bogus',
          projectId: 1,
          payloadDigest: 'digest-bogus',
          rootId: 'root-1',
          locationRevision: 1,
          expectedSelectionRevision: null,
          selectionRevision: 1,
          expectedGeneration: null,
          fromGeneration: null,
          creationOperationId: null,
          runId: null,
          status: sql`'bogus'`,
          generation: null,
          detail: null,
        }),
      );

      const failure = yield* Effect.flip(held.units.read((unit) => held.operations.of('t1', 'op-bogus', unit)));
      expect(failure).toMatchObject({ key: 't1/op-bogus' });
      expect(isThreadTargetStorageFailed(failure)).toBe(true);
    }),
    storage,
  ),
);
