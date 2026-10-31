import { Connections, sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { type EffectSQLiteBunDatabase, makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { migrate } from 'drizzle-orm/sqlite-core/effect/session';
import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  GraphStore,
  MachineStore,
  type MigrationChain,
  type SchemaState,
  type Store,
  type StoreBrand,
  storeDb,
  type StoreFailure,
  type StoreIdentity,
  StoreIdentityConflict,
  type StoreOpenFailure,
  WRITER_STALL_MS,
  type WriterStall,
} from '../contract/service/store.js';
import { applyMigration, chain, pendingMigrations, resolveMigration, schemaState } from './chain.js';
import { translateBaseline } from './baseline.js';
import { seedDatabase } from './seed.js';
import { storeTransaction, UnitStore, WriterTimings } from './transaction.js';
import { type Freeing, reclaiming, vacuumStore } from './vacuum.js';
import { checkStatement, readConsequences } from './writes.js';
import { WriteSetMode } from '../contract/service/writes.js';
import { TableMoves } from './moves.js';
import { ChildLedger } from '../contract/service/children.js';
import { refuseRestore, storeSnapshots } from './snapshot.js';
import { replaceFile } from '../durable/files.js';
import { SnapshotFailed, type StoreSnapshots } from '../contract/service/snapshots.js';
import { randomUUID } from 'node:crypto';
import { StoreOpening } from '../contract/service/opening.js';

export type FreeSpace = (path: string) => Effect.Effect<number>;

export type StoreOptions = {
  readonly freeBytes?: FreeSpace;
  readonly readers?: number;
  readonly withoutSnapshot?: boolean;
  readonly durable?: boolean;
};

const appliedAt =
  <I, Brand extends StoreBrand>(tag: Context.Key<I, Store<Brand>>, migrations: MigrationChain<Brand>, processes: ProcessPool) =>
  (at: string): Effect.Effect<number, StoreOpenFailure> =>
    Effect.scoped(
      Effect.flatMap(Layer.build(connected(tag, at, migrations, processes)), (context) =>
        Effect.map(Context.get(context, tag).db.all<{ name: string }>(sql`select name from __drizzle_migrations`), (rows) => rows.length),
      ),
    );

const fileLayer = <I, Brand extends StoreBrand, A>(
  tag: Context.Key<I, Store<Brand>>,
  path: string,
  migrations: MigrationChain<Brand>,
  options: StoreOptions,
  processes: ProcessPool,
  mint: (opened: Opened) => Context.Context<A>,
): Layer.Layer<A, StoreOpenFailure> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      if (path !== ':memory:') {
        yield* fs.makeDirectory(dirname(path), { recursive: true });
        yield* refuseRestore(path);
        if (!(yield* fs.exists(path))) {
          const observe = yield* StoreOpening;
          const applied = appliedAt(tag, migrations, processes);
          yield* fs.copyFile(
            yield* seedDatabase(migrations, (seed) =>
              applied(seed).pipe(
                Effect.provideService(StoreOpening, (step) => (step.phase === 'opened' ? Effect.void : observe({ ...step, path }))),
              ),
            ),
            path,
          );
        }
      }
      return connection(
        path,
        migrations,
        mint,
        processes,
        options.freeBytes ?? freeSpaceOf,
        options.readers,
        options.withoutSnapshot,
        options.durable,
      );
    }),
  ).pipe(Layer.provide(BunFileSystem.layer));

export type PoolSource = ProcessPool | Effect.Effect<ProcessPool>;

export const poolOf = (source: PoolSource): Effect.Effect<ProcessPool> => (source instanceof ProcessPool ? Effect.succeed(source) : source);

const pooled = <A>(source: PoolSource, opened: (processes: ProcessPool) => Layer.Layer<A, StoreOpenFailure>) =>
  Layer.unwrap(Effect.map(poolOf(source), opened));

export const storeLayer = <I, Brand extends StoreBrand>(
  tag: Context.Key<I, Store<Brand>>,
  path: string,
  migrations: MigrationChain<Brand>,
  options: StoreOptions,
  processes: PoolSource,
): Layer.Layer<I, StoreOpenFailure> =>
  pooled(processes, (pool) => fileLayer(tag, path, migrations, options, pool, (opened) => Context.make(tag, storeOf<Brand>(opened))));

export const machineFileLayer = (
  path: string,
  migrations: MigrationChain<'machine'>,
  options: StoreOptions,
  processes: PoolSource,
): Layer.Layer<MachineStore | GraphStore, StoreOpenFailure> =>
  pooled(processes, (pool) =>
    fileLayer(MachineStore, path, migrations, options, pool, (opened) =>
      Context.make(MachineStore, storeOf<'machine'>(opened)).pipe(Context.add(GraphStore, storeOf<'graph'>(opened))),
    ),
  );

const seededLayer = <I, Brand extends StoreBrand, A>(
  tag: Context.Key<I, Store<Brand>>,
  migrations: MigrationChain<Brand>,
  opened: (path: string, processes: ProcessPool) => Layer.Layer<A, StoreOpenFailure>,
  processes: PoolSource,
): Layer.Layer<A, StoreOpenFailure> =>
  pooled(processes, (pool) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = join(yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'tagma-seeded-' }), 'tagma.sqlite');
        yield* fs.copyFile(yield* seedDatabase(migrations, appliedAt(tag, migrations, pool)), path);
        return opened(path, pool);
      }),
    ).pipe(Layer.provide(BunFileSystem.layer)),
  );

export const seededStoreLayer = <I, Brand extends StoreBrand>(
  tag: Context.Key<I, Store<Brand>>,
  migrations: MigrationChain<Brand>,
  options: StoreOptions,
  processes: PoolSource,
): Layer.Layer<I, StoreOpenFailure> =>
  seededLayer(tag, migrations, (path, pool) => storeLayer(tag, path, migrations, options, pool), processes);

export const seededMachineLayer = (
  migrations: MigrationChain<'machine'>,
  options: StoreOptions,
  processes: PoolSource,
): Layer.Layer<MachineStore | GraphStore, StoreOpenFailure> =>
  seededLayer(MachineStore, migrations, (path, pool) => machineFileLayer(path, migrations, options, pool), processes);

function connected<I, Brand extends StoreBrand>(
  tag: Context.Key<I, Store<Brand>>,
  path: string,
  migrations: MigrationChain<Brand>,
  processes: ProcessPool,
): Layer.Layer<I, StoreOpenFailure> {
  return connection(path, migrations, (opened) => Context.make(tag, storeOf<Brand>(opened)), processes);
}

function connection<Brand extends StoreBrand, A>(
  path: string,
  migrations: MigrationChain<Brand>,
  mint: (opened: Opened) => Context.Context<A>,
  processes: ProcessPool,
  freeBytes: FreeSpace = freeSpaceOf,
  readers?: number,
  withoutSnapshot = false,
  durable = true,
): Layer.Layer<A, StoreOpenFailure> {
  return Layer.unwrap(
    Effect.map(Effect.all([WriteSetMode, ChildLedger]), ([mode, ledger]) => {
      const timings = new WriterTimings();
      const identity = { path, generation: ++generations };
      const classed = durable && mode === 'refuse';
      return Layer.effectContext(
        Effect.map(open<Brand>(identity, migrations, processes, freeBytes, timings, withoutSnapshot, classed), (opened) =>
          mint({ ...opened, processes, durable }),
        ),
      ).pipe(
        Layer.provide(
          sqliteProcessLayer(
            {
              filename: path,
              readers,
              checkConnection: Effect.flatMap(UnitStore, (held) =>
                held === null || held === identity
                  ? Effect.void
                  : Effect.die(new StoreIdentityConflict({ expected: held, actual: identity })),
              ),
              checkStatement: checkStatement(identity),
              synchronous: !durable ? 'off' : classed ? 'full' : undefined,
              fullfsync: classed && process.platform === 'darwin',
              onLost: (reason) => {
                console.error(`[tagma] the store at ${path} is gone: ${reason}`);
                process.exit(1);
              },
              onReaders: (said) => {
                console.warn(
                  said._tag === 'ReaderLost'
                    ? `[tagma] ${path}: a reader is gone: ${said.reason}`
                    : `[tagma] ${path}: a declared read ran on the writer: ${said.failure.message}`,
                );
              },
              onStatement: (timing) => timings.note(timing),
              onSpawned: ({ pid }) => ledger.record({ pid, role: 'database' }),
            },
            processes,
          ),
        ),
      );
    }),
  );
}

const freeSpaceOf: FreeSpace = (path) => Effect.promise(() => statfs(dirname(path)).then((disk) => disk.bsize * disk.bavail));

const elapsed = (startedAt: number, now: number): string => `${((now - startedAt) / 1000).toFixed(1)}s`;

let generations = 0;

type Opened = {
  readonly processes: ProcessPool;
  readonly durable: boolean;
  readonly db: EffectSQLiteBunDatabase;
  readonly schema: SchemaState;
  readonly identity: StoreIdentity;
  readonly timings: WriterTimings;
  readonly freeBytes: FreeSpace;
  readonly classed: boolean;
  readonly freeing: Freeing;
  readonly moves: TableMoves;
  readonly stalled: Effect.Effect<WriterStall | null>;
};

const storeOf = <Brand extends StoreBrand>({
  db,
  schema,
  identity,
  timings,
  freeBytes,
  classed,
  freeing,
  moves,
  stalled,
  processes,
  durable,
}: Opened): Store<Brand> => ({
  processes,
  durable,
  db: storeDb<Brand>(db),
  path: identity.path,
  identity,
  schema,
  transaction: storeTransaction<Brand>(db, timings, identity, moves, classed, processes.writerMetrics),
  readOnly: (work) =>
    Effect.scoped(
      Effect.flatMap(makeWithDefaults(), (reader) => work(storeDb<Brand>(reader))).pipe(
        Effect.provide(
          Layer.unwrap(
            Effect.map(ChildLedger, (ledger) =>
              sqliteProcessLayer(
                {
                  filename: identity.path,
                  readonly: true,
                  readers: 0,
                  onLost: (reason) => console.warn(`[tagma] an isolated reader at ${identity.path} is gone: ${reason}`),
                  onSpawned: ({ pid }) => ledger.record({ pid, role: 'database' }),
                },
                processes,
              ),
            ),
          ),
        ),
      ),
    ),
  vacuum: () => vacuumStore(db, identity.path, freeBytes),
  freeing,
  moves,
  stalled,
});

const open = <Brand extends StoreBrand>(
  identity: StoreIdentity,
  migrations: MigrationChain<Brand>,
  processes: ProcessPool,
  freeBytes: FreeSpace,
  timings: WriterTimings,
  withoutSnapshot = false,
  classed = false,
) =>
  Effect.flatMap(
    Effect.tap(migrated(identity.path, migrations, processes, withoutSnapshot), ({ db }) => readConsequences(identity, db)),
    ({ db, schema }) => {
      const moves = new TableMoves();
      return Effect.zipWith(
        reclaiming(db, storeTransaction<'machine'>(db, timings, identity, moves, classed, processes.writerMetrics)),
        Connections,
        (freeing, connections) => ({
          db,
          schema,
          identity,
          timings,
          freeBytes,
          classed,
          freeing,
          moves,
          stalled: Effect.map(connections.writer, ({ holder, waiting }) =>
            holder === null || holder.quietMs < WRITER_STALL_MS ? null : { ...holder, waiting },
          ),
        }),
      );
    },
  );

const migrated = Effect.fn('Store.open')(function* (
  path: string,
  migrations: { readonly folder: string; readonly snapshots?: StoreSnapshots['Service'] },
  processes: ProcessPool,
  withoutSnapshot = false,
) {
  const db = yield* makeWithDefaults();

  const local = chain(migrations);
  const snapshots = migrations.snapshots ?? storeSnapshots({}, processes);
  const pending = yield* pendingMigrations(db, local, migrations.folder);
  const observe = yield* StoreOpening;
  yield* observe({ phase: 'opening', path, at: yield* Clock.currentTimeMillis, pending: pending.length });
  const translated = yield* translateBaseline(db, local, migrations.folder, (folded) =>
    path === ':memory:' ? Effect.void : Effect.asVoid(snapshots.release(path, folded)),
  );
  if (translated) console.log(`[tagma] ${path}: the migration ledger was folded into the baseline`);
  yield* db.run(sql`PRAGMA foreign_keys = OFF`);
  for (const migration of pending) yield* resolveMigration(migration);
  if (path !== ':memory:') yield* snapshots.sweep(path);
  if (pending.length > 0 && path !== ':memory:') {
    const existing = yield* db.all(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' limit 1`);
    if (existing.length > 0) {
      if (withoutSnapshot) {
        const receipt = `${path}.without-snapshot.${randomUUID()}.json`;
        const durability = yield* replaceFile(
          receipt,
          JSON.stringify({
            version: 1,
            at: new Date(yield* Clock.currentTimeMillis).toISOString(),
            migrations: pending.map(({ name, hash }) => ({ name, hash })),
          }),
        ).pipe(Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.reason })));
        if (durability === 'degraded') console.warn(`[tagma] migration override receipt has degraded durability: ${receipt}`);
        yield* snapshots.release(path);
      } else yield* snapshots.take({ path, db }, pending);
    }
  }
  const waiting = new Set(pending.map((migration) => migration.name));
  yield* migrate(
    local.filter((migration) => !waiting.has(migration.name)),
    db._.session,
  );
  for (const [index, migration] of pending.entries()) {
    console.log(`[tagma] migration ${index + 1}/${pending.length} ${migration.name} …`);
    const startedAt = yield* Clock.currentTimeMillis;
    yield* observe({ phase: 'migration', path, at: startedAt, name: migration.name, index: index + 1, total: pending.length });
    const checked = yield* applyMigration(db, migration);
    console.log(
      `[tagma] migration ${index + 1}/${pending.length} ${migration.name} landed, foreign keys checked, in ${elapsed(startedAt, yield* Clock.currentTimeMillis)}`,
    );
    for (const scan of checked.scans) {
      console.log(
        `[tagma] migration ${migration.name}: ${scan.table} has no index on the key it references, so checking it for removed keys scanned the whole table in ${scan.ms} ms`,
      );
    }
  }
  yield* db.run(sql`PRAGMA foreign_keys = ON`);

  const schema = yield* schemaState(db);
  if (path !== ':memory:') yield* snapshots.opened({ path, db });
  yield* observe({ phase: 'opened', path, at: yield* Clock.currentTimeMillis, applied: pending.length, total: schema.applied });
  return { db, schema };
});
