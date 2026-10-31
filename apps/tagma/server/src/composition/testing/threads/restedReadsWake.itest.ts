import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Clock, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadLog, restedFolds, threadStore } from '../../../native-harness/testing/doubles.js';
import { threadEntry } from '../../../threads/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { restFor } from '../../../threads/testing/rest.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { threadEvent } from '../../../threads/testing/doubles.js';
import { exportThreadRollout } from '../../../threads/testing/doubles.js';
import { rehydrateThreadRecords } from '../../../threads/testing/doubles.js';
import { restedReads } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

const text = (id: string, body: string): ThreadTranscriptEntry => ({ id, type: 'message', role: 'assistant', text: body });

it.live(
  'a read arriving mid-wake answers the file, never a prefix of the rows',
  Effect.fnUntraced(function* () {
    const inner = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(
        Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
      ),
    );
    const entered = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    const held = Layer.effect(
      MachineStore,
      Effect.map(MachineStore, (store) => {
        const transaction: MachineStore['Service']['transaction'] = (operation, body, options) => {
          const name = typeof operation === 'string' ? operation : operation.operation;
          return name === 'thread.rehydrate.rows'
            ? Effect.andThen(
                Deferred.succeed(entered, undefined),
                Effect.andThen(Deferred.await(proceed), store.transaction(operation, body, options)),
              )
            : store.transaction(operation, body, options);
        };
        return { ...store, transaction };
      }),
    );
    const runtime = yield* Layer.build(
      Layer.mergeAll(inner, held.pipe(Layer.provide(inner)), BunFileSystem.layer, Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
    );
    const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-midwake-' });
    const store = yield* Effect.provide(MachineStore, runtime);
    const units = yield* Effect.provide(MachineUnits, runtime);
    const projectId = yield* Effect.provide(
      Effect.map(
        store.db
          .insert(project())
          .values({ name: 'midwake', repoKey: '/midwake', rootPath: '/midwake', createdAt: new Date(yield* Clock.currentTimeMillis) })
          .returning({ id: project().id })
          .get(),
        (row) => row?.id ?? 0,
      ),
      runtime,
    );
    const rows = yield* Effect.provide(
      Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)),
      runtime,
    );
    const row = yield* Effect.provide(rows.insert({ ownerId: 'operator', agentId: 'tagma' }), runtime);
    yield* Effect.provide(Effect.void.pipe(Effect.andThen(scopeRecord(store.db, row.id, { projectId }))), runtime);
    const entries = [text('w1', 'one'), text('w2', 'two'), text('w3', 'three')];
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.insert(threadEvent()).values(
          entries.map((carried, at) => ({
            threadId: row.id,
            position: at + 1,
            id: `event-${carried.id}`,
            kind: 'entry',
            payload: { entry: carried },
          })),
        );
        yield* store.db.insert(threadEntry()).values(
          entries.map((carried, ord) => ({
            threadId: row.id,
            ord,
            entryId: carried.id,
            runId: null,
            type: 'text',
            entry: carried,
          })),
        );
        yield* store.db.update(threadLog()).set({ historyThrough: 3, entriesThrough: 3 }).where(eq(threadLog().threadId, row.id));
      }),
      runtime,
    );
    const path = join(home, String(projectId), `${row.id}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId: row.id, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.delete(threadEntry()).where(eq(threadEntry().threadId, row.id));
        yield* restFor(store.db, row.id, new Date(yield* Clock.currentTimeMillis));
      }),
      runtime,
    );

    const reads = yield* Effect.provide(restedReads(ENTRY_KINDS, home), runtime);
    const rested = yield* Effect.provide(
      Effect.flatMap(Effect.all([makeThreadRecords, restedFolds(reads, ENTRY_KINDS)]), ([records, folds]) =>
        threadStore(records, ENTRY_KINDS, folds),
      ),
      runtime,
    );
    const settled = yield* Effect.provide(rested.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 }), runtime);

    yield* Effect.provide(
      Effect.gen(function* () {
        const wake = yield* Effect.forkChild(rehydrateThreadRecords({ threadId: row.id, path, parts: nativeOnlyParts }));
        yield* Effect.gen(function* () {
          yield* Deferred.await(entered);
          const page = yield* rested.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 });
          const standing = yield* units.read((unit) =>
            unit.run(store.db.select({ id: threadEntry().entryId }).from(threadEntry()).where(eq(threadEntry().threadId, row.id)).all()),
          );
          expect(standing).toEqual([]);
          expect(page).toEqual(settled);
        }).pipe(Effect.ensuring(Deferred.succeed(proceed, undefined)));
        yield* Fiber.join(wake);
      }),
      runtime,
    );
    expect(yield* Effect.provide(rested.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 }), runtime)).toEqual(settled);
  }),
);
