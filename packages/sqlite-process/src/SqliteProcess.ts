import { ProcessPool } from './ProcessPool.js';
import { CEILING_CAP, declare } from '@runlith/held/Held';
import * as Duration from 'effect/Duration';
import { SqliteClient, TypeId, type SqliteClientConfig } from '@effect/sql-sqlite-bun/SqliteClient';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Reactivity from 'effect/reactivity/Reactivity';
import * as Client from 'effect/sql/SqlClient';
import * as Statement from 'effect/sql/Statement';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import * as Exit from 'effect/Exit';
import type { Synchronous } from './channel.js';
import { openConnection, type ProcessConnection, type SpawnedChild, type StatementTiming } from './connection.js';
import { makePrograms, Programs } from './programs.js';
import { makeReaderPool, type OpenReader, type PoolState, type ReaderPool } from './ReaderPool.js';
import { writerPermit } from './writerPermit.js';
import type { ReadClass } from './ReaderLanes.js';

export type SqliteProcessConfig = SqliteClientConfig & {
  readonly onLost: (reason: string) => void;
  readonly mmapBytes?: number | undefined;
  readonly readers?: number | undefined;
  readonly onReaders?: ((said: ReaderEvent) => void) | undefined;
  readonly onStatement?: ((timing: StatementTiming) => void) | undefined;
  readonly onSpawned?: ((spawned: SpawnedChild) => () => void) | undefined;
  readonly checkConnection?: Effect.Effect<void, SqlError> | undefined;
  readonly checkStatement?: ((sql: string) => Effect.Effect<void, SqlError>) | undefined;
  readonly synchronous?: Synchronous | undefined;
  readonly fullfsync?: boolean | undefined;
};

export type ReaderEvent =
  | { readonly _tag: 'ReaderLost'; readonly reason: string }
  | { readonly _tag: 'ReadOnWriter'; readonly failure: SqlError };

export class Readers extends Context.Service<Readers, { readonly state: Effect.Effect<PoolState | undefined> }>()(
  '@runlith/sqlite-process/Readers',
) {}

export const Handover = Context.Reference<Effect.Effect<boolean>>('@runlith/sqlite-process/Handover', {
  defaultValue: () => Effect.succeed(false),
});

export type WriterStanding = {
  readonly holder: { readonly heldFor: string | null; readonly heldMs: number; readonly quietMs: number } | null;
  readonly waiting: number;
};

export type SnapshotReader = {
  readonly run: <A, E, R>(query: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;
};

export class Connections extends Context.Service<
  Connections,
  {
    readonly state: Effect.Effect<'open' | 'handing-over' | 'retired'>;
    readonly writer: Effect.Effect<WriterStanding>;
    readonly retire: Effect.Effect<void, SqlError>;
    readonly handover: Effect.Effect<void, SqlError>;
    readonly readSnapshot: <A, E, R>(
      work: (reader: SnapshotReader) => Effect.Effect<A, E, R>,
      kind?: ReadClass,
    ) => Effect.Effect<A, E | SqlError, R>;
  }
>()('@runlith/sqlite-process/Connections') {}

const ATTR_DB_SYSTEM_NAME = 'db.system.name';

const snapshotRefused = (message: string): SqlError =>
  new SqlError({ reason: classifySqliteError(new Error(message), { operation: 'readSnapshot', message }) });

type Declared = 'write' | 'read' | 'bulk';

const ReadOnly = Context.Reference<Declared>('@runlith/sqlite-process/ReadOnly', { defaultValue: () => 'write' });

export const readOnly = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, ReadOnly, 'read');

export const bulk = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.provideService(effect, ReadOnly, 'bulk');

export const writes = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.provideService(effect, ReadOnly, 'write');

const Marked = Context.Reference<Synchronous | null>('@runlith/sqlite-process/Synchronous', { defaultValue: () => null });

export const synchronously =
  (level: Synchronous) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, Marked, level);

export const sqliteProcessLayer = (
  config: SqliteProcessConfig,
  processes: ProcessPool,
): Layer.Layer<SqliteClient | Client.SqlClient | Readers | Connections | Programs> =>
  Layer.effectContext(
    Effect.orDie(
      Effect.map(make(processes, config), ({ client, readers, connections, programs }) =>
        Context.make(SqliteClient, client).pipe(
          Context.add(Client.SqlClient, client),
          Context.add(Readers, readers),
          Context.add(Connections, connections),
          Context.add(Programs, programs),
        ),
      ),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

const make = Effect.fnUntraced(function* (processes: ProcessPool, options: SqliteProcessConfig) {
  let retired = false;
  let accepting = true;
  const live = Effect.suspend(() =>
    retired
      ? Effect.fail(
          new SqlError({
            reason: classifySqliteError(new Error('The owner retired these sqlite connections.'), {
              operation: 'acquire',
              message: 'The owner retired these sqlite connections.',
            }),
          }),
        )
      : (options.checkConnection ?? Effect.void),
  );
  const admission = Effect.suspend(() =>
    accepting
      ? live
      : Effect.fail(
          new SqlError({
            reason: classifySqliteError(new Error('The sqlite owner is handing over its connections.'), {
              operation: 'acquire',
              message: 'The sqlite owner is handing over its connections.',
            }),
          }),
        ),
  );
  const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
  const transformRows = options.transformResultNames ? Statement.defaultTransforms(options.transformResultNames).array : undefined;

  const report = options.onStatement;
  const writer = yield* openConnection(processes, {
    ...options,
    durable: options.synchronous !== 'off',
    checkConnection: live,
    onStatement: report === undefined ? undefined : (timing) => report({ ...timing, source: 'writer' }),
  });
  if (options.fullfsync === true) {
    yield* writer.executeRaw('PRAGMA fullfsync = ON', []);
    yield* writer.executeRaw('PRAGMA checkpoint_fullfsync = ON', []);
  }
  let level: Synchronous | undefined;
  const setLevel = (wanted: Synchronous | undefined): Effect.Effect<void, SqlError> =>
    wanted === undefined || wanted === level
      ? Effect.void
      : Effect.map(writer.executeRaw(`PRAGMA synchronous = ${wanted.toUpperCase()}`, []), () => {
          level = wanted;
        });
  yield* setLevel(options.synchronous);

  const ceiling = Math.min(options.readers ?? processes.readers.ceiling, processes.readers.ceiling);
  const wanted = ceiling > 0 && options.filename !== ':memory:' && options.readonly !== true;
  const say = (said: ReaderEvent): void => {
    if (options.onReaders === undefined) return;
    try {
      options.onReaders(said);
    } catch {}
  };

  let pool: ReaderPool | undefined;

  const openReader: OpenReader = (onLost, lane) =>
    openConnection(
      processes,
      {
        filename: options.filename,
        readonly: true,
        checkConnection: live,
        disableWAL: options.disableWAL,
        busyTimeout: options.busyTimeout,
        mmapBytes: options.mmapBytes,
        onSpawned: options.onSpawned,
        onLost: (reason) => {
          onLost(reason);
          say({ _tag: 'ReaderLost', reason });
        },
        onStatement: (timing) => {
          pool?.noteStatement(timing);
          report?.({ ...timing, source: 'reader' });
        },
      },
      lane,
    );

  const writerHold = declare<string>({
    name: 'sqlite-process/writer',
    owner: 'sqlite-process',
    rank: 500,
    key: (path) => path,
    concurrency: 1,
    threshold: Duration.millis(250),
    ceilings: { hold: CEILING_CAP, wait: CEILING_CAP, leaves: 'the transaction remains fenced until its scope closes' },
    external: { named: 'sqlite child', callsBack: false },
  });
  const permit = writerPermit(writer, writerHold, options.filename, setLevel, options.synchronous, Marked, live);
  const { programs, drained } = yield* makePrograms({
    writer,
    exclusive: permit.exclusive,
    admission,
    level: () => level,
    settled: (wanted) => {
      level = wanted;
    },
  });
  const onWriter = permit.statement;
  pool = wanted ? yield* makeReaderPool({ ceiling, open: openReader, lanes: processes.readers }) : undefined;
  const offWriter = (take: Effect.Effect<ProcessConnection, SqlError>) =>
    Effect.catchTag(take, 'SqlError', (failure) =>
      Effect.flatMap(
        Effect.sync(() => say({ _tag: 'ReadOnWriter', failure })),
        () => onWriter,
      ),
    );
  const reads = pool === undefined ? onWriter : offWriter(pool.take);
  const bulkReads = pool === undefined ? onWriter : offWriter(pool.takeBulk);
  const acquirer = Effect.andThen(
    admission,
    Effect.flatMap(ReadOnly, (declared) => (declared === 'read' ? reads : declared === 'bulk' ? bulkReads : onWriter)),
  );

  const transactionAcquirer = Effect.andThen(admission, permit.transaction);

  const client = Object.assign(
    (yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer,
      beginTransaction: 'BEGIN IMMEDIATE',
      spanAttributes: [...(options.spanAttributes ? Object.entries(options.spanAttributes) : []), [ATTR_DB_SYSTEM_NAME, 'sqlite']],
      transformRows,
    })) as SqliteClient,
    {
      [TypeId]: TypeId,
      config: options,
      export: Effect.scoped(
        Effect.andThen(
          admission,
          Effect.flatMap(onWriter, (taken) => taken.export),
        ),
      ),
      loadExtension: (path: string) =>
        Effect.scoped(
          Effect.andThen(
            admission,
            Effect.flatMap(onWriter, (taken) => taken.loadExtension(path)),
          ),
        ),
    },
  );
  const physical = Context.get(Context.empty(), Clock.Clock);
  const connections = Connections.of({
    readSnapshot: (work, kind = 'point') =>
      Effect.scoped(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* admission;
            const readers = pool;
            if (readers === undefined) return yield* snapshotRefused('This sqlite owner has no read-only lane for a snapshot.');
            const connection = yield* restore(kind === 'bulk' ? readers.takeBulk : readers.take);
            yield* Effect.onError(restore(connection.executeRaw('BEGIN', [])), () => readers.discard(connection));
            let active = true;
            const reader: SnapshotReader = {
              run: <A, E, R>(query: Effect.Effect<A, E, R>) =>
                Effect.suspend<A, E | SqlError, R>(() =>
                  active
                    ? Effect.provideService(query, client.transactionService, [connection, 0])
                    : Effect.fail(snapshotRefused('This sqlite read snapshot has ended.')),
                ),
            };
            return yield* Effect.onExit(restore(Effect.suspend(() => work(reader))), (exit) =>
              Effect.suspend(() => {
                active = false;
                return Effect.asVoid(
                  Effect.onError(connection.executeRaw(Exit.isSuccess(exit) ? 'COMMIT' : 'ROLLBACK', []), () =>
                    readers.discard(connection),
                  ),
                );
              }),
            );
          }),
        ),
      ).pipe(Effect.withSpan('Connections.readSnapshot')),
    state: Effect.sync(() => (retired ? 'retired' : accepting ? 'open' : 'handing-over')),
    writer: Effect.sync(() => {
      const now = Number(physical.monotonicTimeNanosUnsafe()) / 1_000_000;
      const [holder] = writerHold.holders(options.filename);
      const waiting = writerHold.standing(options.filename)[0]?.waiters ?? 0;
      if (holder === undefined) return { holder: null, waiting };
      const quiet = writer.quietSince();
      return {
        holder: {
          heldFor: holder.heldFor,
          heldMs: now - holder.since,
          quietMs: quiet === null ? 0 : now - Math.max(quiet, holder.since),
        },
        waiting,
      };
    }),
    handover: Effect.uninterruptible(
      Effect.gen(function* () {
        accepting = false;
        yield* permit.drain;
        yield* drained;
        retired = true;
        const ended = yield* Effect.forEach([writer, ...(pool?.connections ?? [])], (connection) => Effect.exit(connection.handover), {
          concurrency: 3,
        });
        const failed = ended.find(Exit.isFailure);
        if (failed !== undefined) return yield* Effect.failCause(failed.cause);
      }),
    ),
    retire: Effect.gen(function* () {
      retired = true;
      const ended = yield* Effect.forEach([writer, ...(pool?.connections ?? [])], (connection) => Effect.exit(connection.retire), {
        concurrency: 3,
      });
      const failed = ended.find(Exit.isFailure);
      if (failed !== undefined) return yield* Effect.failCause(failed.cause);
    }),
  });
  const handingOver = yield* Handover;
  yield* Effect.addFinalizer(() =>
    Effect.flatMap(handingOver, (requested) => (requested ? connections.handover.pipe(Effect.orDie) : Effect.void)),
  );
  return { client, readers: Readers.of({ state: Effect.sync(() => pool?.state) }), connections, programs };
});
