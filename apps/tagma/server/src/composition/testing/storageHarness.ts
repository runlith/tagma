import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { fixtureMigrations } from './migrations.js';
import type { ThreadResourceLedgerHarness } from '@runlith/agent/thread/conformance/resources';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { Clock, type Context, Effect, Exit, FileSystem, Layer, Scope } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { threadRecord } from '../../thread-record/store/table.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { storeLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { scopeRecord } from '../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import {
  SCOPED_RUN,
  threadCompactionStore,
  threadRunStores,
  threadStore,
  nativeTransitions,
} from '../../native-harness/testing/doubles.js';
import { project } from '../../projects/testing/doubles.js';
import { sqliteThreadJournal, threadInboxStore, threadResourceStore, approvalPreferences } from '../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../manifest.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';

const SCOPES: Record<string, { faceted: boolean }> = {
  'scope-a': { faceted: true },
  'scope-b': { faceted: false },
};

function facetedScope(scope: string): boolean {
  const known = SCOPES[scope];
  if (!known) throw new Error(`The conformance suite asked for an unknown scope: ${scope}.`);
  return known.faceted;
}

export const openThreadStorage = () => Effect.map(openThreadStore(), (opened) => opened.storage);

type OpenedThreadStore = {
  readonly storage: ThreadResourceLedgerHarness<Unit<'machine'>, WriteUnit<'machine'>>;
  readonly db: MachineStore['Service']['db'];
  readonly context: Context.Context<MachineStore | MachineUnits>;
  readonly units: MachineUnits['Service'];
  reopen(): Effect.Effect<OpenedThreadStore, unknown, Scope.Scope>;
  reset(): Effect.Effect<void, unknown>;
};

export const openThreadStore = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'tagma-threads-' });
  return yield* connectionAt(join(directory, 'tagma.sqlite'));
}, Effect.provide(BunFileSystem.layer));

export const openThreadStoreAt = Effect.fnUntraced(function* (directory: string, path: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.addFinalizer(() => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie));
  return yield* connectionAt(path);
}, Effect.provide(BunFileSystem.layer));

const connectionAt = Effect.fnUntraced(function* (path: string): Effect.fn.Return<OpenedThreadStore, unknown, Scope.Scope> {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const pool = yield* sharedPool;
  const context = yield* Layer.buildWithScope(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations, { readers: 1 }, pool))),
    ),
    scope,
  );
  return yield* makeStore(path, scope).pipe(Effect.provide(context));
});

const makeStore = Effect.fnUntraced(function* (
  path: string,
  scope: Scope.Closeable,
): Effect.fn.Return<OpenedThreadStore, unknown, MachineStore | MachineUnits> {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* makeThreadRecords;
  const store = yield* threadStore(records, ENTRY_KINDS);
  const runsOf = yield* threadRunStores(records, ENTRY_KINDS);
  const standing = yield* db.select({ id: project().id }).from(project()).get();
  const created =
    standing ??
    (yield* db
      .insert(project())
      .values({
        name: 'conformance',
        repoKey: '/conformance',
        rootPath: '/conformance',
        createdAt: new Date(yield* Clock.currentTimeMillis),
      })
      .returning({ id: project().id })
      .get());
  if (!created) return yield* Effect.die('The conformance project could not be created.');
  const threads = {
    ...store,
    insertChild: (parentThreadId: string, values: Parameters<typeof store.insertChild>[1], tx: WriteUnit<'machine'>) =>
      store.insertChild(parentThreadId, values, tx).pipe(
        Effect.tap((child) =>
          Effect.gen(function* () {
            const parent = yield* tx.run(
              db.select({ origin: threadRecord.origin }).from(threadRecord).where(eq(threadRecord.id, parentThreadId)).get(),
            );
            if (parent?.origin === 'scoped') yield* tx.run(scopeRecord(db, child.id, { projectId: created.id }));
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof ThreadNotFoundError || cause instanceof ThreadStorageFailed
            ? cause
            : new ThreadStorageFailed({ call: 'insertChild', cause }),
        ),
      ),
  };
  const reopen = Effect.fnUntraced(function* () {
    yield* Scope.close(scope, Exit.void);
    return yield* connectionAt(path);
  });
  const storage: ThreadResourceLedgerHarness<Unit<'machine'>, WriteUnit<'machine'>> = {
    aggregate: threads,
    compaction: yield* threadCompactionStore(),
    inbox: yield* threadInboxStore(ENTRY_KINDS),
    eventLog: yield* sqliteThreadJournal(),
    transitions: yield* nativeTransitions(threads),
    ownerSettings: yield* approvalPreferences(),
    runs: ({ ownerId, scope }) => runsOf({ ownerId, scope: facetedScope(scope) ? SCOPED_RUN() : sql`not (${SCOPED_RUN()})` }),
    createThread: Effect.fnUntraced(function* ({ ownerId, scope, transport }) {
      return yield* threads
        .transaction((tx) =>
          Effect.gen(function* () {
            const row = yield* threads.insert({ ownerId, agentId: 'tagma', transport }, tx);
            if (facetedScope(scope)) yield* tx.run(scopeRecord(db, row.id, { projectId: created.id }));
            return row;
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call: 'createThread', cause }),
          ),
        );
    }),
    resources: yield* threadResourceStore(),
    kinds: ENTRY_KINDS,
    reopen: () => Effect.map(reopen(), (opened) => opened.storage),
    dispose: () => Scope.close(scope, Exit.void),
  };
  return {
    storage,
    db,
    context: yield* Effect.context<MachineStore | MachineUnits>(),
    units,
    reopen,
    reset: () =>
      units.write('conformance.reset', (tx) =>
        Effect.gen(function* () {
          yield* tx.run(db.delete(threadRecord));
          const detached = yield* storage.resources.detached(tx);
          const byKind = new Map<string, string[]>();
          for (const row of detached) {
            const ids = byKind.get(row.kind) ?? [];
            ids.push(row.id);
            byKind.set(row.kind, ids);
          }
          for (const [kind, ids] of byKind) yield* storage.resources.release(kind, ids, tx);
          yield* tx.run(db.run(sql`delete from approval_preference`));
        }),
      ),
  };
});
