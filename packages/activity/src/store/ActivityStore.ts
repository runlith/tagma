import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunWorker from '@effect/platform-bun/BunWorker';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { prepareEngine, selectEngine } from '@runlith/sqlite-process/engine';
import { Connections, sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { type EffectSQLiteBunDatabase, makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/sqlite-core/effect/session';
import { Cause, Clock, Context, Duration, Effect, Exit, Fiber, FileSystem, Latch, Layer, PubSub, Schema, Semaphore, Stream } from 'effect';
import * as EffectWorker from 'effect/workers/Worker';
import type { WorkerError } from 'effect/workers/WorkerError';
import type { ActivityFact, ActivityLoss, ActivityOpened } from '../fact';
import type { ActivityLog } from '../log';
import { Bodies, type BodyReply, type BodyRequest } from './bodies';
import { prepareWorker } from '@runlith/held/PreparedWorker';
import { activityFaults, faultsAging } from './faulting';
import { ActivityFaults } from './faults';
import { activityReading } from './reading';
import { ActivityRecord, type ActivityFreshness, ActivityUnreadable } from './record';
import { type Keeping, kept, orphaned } from './upkeep';
import { type Lost, Writer, written } from './writer';

const PreparedBodyWorker = Context.Reference<EffectWorker.Worker<BodyReply, BodyRequest> | undefined>(
  '@runlith/activity/PreparedBodyWorker',
  { defaultValue: () => undefined },
);

export const activityPreparationLayer = Layer.effect(
  PreparedBodyWorker,
  Effect.gen(function* () {
    const platform = yield* EffectWorker.WorkerPlatform;
    return yield* prepareWorker(yield* platform.spawn<BodyReply, BodyRequest>(0));
  }),
).pipe(Layer.provide(BunWorker.layer(() => new Worker(new URL('./body.worker.ts', import.meta.url), { type: 'module' }))));

export type ActivityStoreConfig = {
  readonly database: string;
  readonly bodies: string;
  readonly migrations: string;
  readonly keeping: () => Keeping;
  readonly upkeepAfter?: Effect.Effect<void>;
  readonly projectsOf: (threads: readonly string[]) => Effect.Effect<ReadonlyMap<string, number | null>, unknown>;
  readonly processes?: ProcessPool;
  readonly readingsMax?: number;
  readonly pendingMax?: number;
};

export type ActivitySettlement = { readonly unwritten: number };

export type ActivityHealth = {
  readonly state: 'live' | 'degraded' | 'closed';
  readonly pending: number;
  readonly dropped: number;
  readonly lost: readonly ActivityLoss[];
  readonly retryAt: number | null;
  readonly reason: string | null;
};

export class ActivityStore extends Context.Service<
  ActivityStore,
  {
    readonly log: ActivityLog;
    readonly settled: Effect.Effect<ActivitySettlement>;
    readonly health: Effect.Effect<ActivityHealth>;
  }
>()('@runlith/activity/ActivityStore') {}

const PENDING_CEILING = 50_000;
const FLUSH_WINDOW = Duration.millis(100);
const UPKEEP_INTERVAL = Duration.minutes(5);
const SETTLE_DEADLINE = Duration.seconds(10);
const BACKOFF_CEILING_MS = 30_000;

export function activityStoreLayer(config: ActivityStoreConfig): Layer.Layer<ActivityStore | ActivityRecord | ActivityFaults, WorkerError> {
  return attempt(config).pipe(Layer.catchCause((cause) => Layer.succeedContext(unavailable(config.database, Cause.pretty(cause)))));
}

function attempt(config: ActivityStoreConfig): Layer.Layer<ActivityStore | ActivityRecord | ActivityFaults, WorkerError> {
  return Layer.unwrap(
    Effect.map(preparedDatabase(config), () => {
      const connection = {
        filename: config.database,
        onLost: (reason: string) => console.error(`[activity] the store at ${config.database} is gone: ${reason}`),
      };
      const database = config.processes === undefined ? sqliteProcessLayer(connection) : sqliteProcessLayer(connection, config.processes);
      return Layer.effectContext(opened(config)).pipe(
        Layer.provide(BunWorker.layer(() => new Worker(new URL('./body.worker.ts', import.meta.url), { type: 'module' }))),
        Layer.provide(Layer.mergeAll(database, BunFileSystem.layer)),
      );
    }),
  ).pipe(Layer.provide(BunFileSystem.layer), Layer.orDie);
}

const resetReceipt = Schema.Struct({ chain: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })) });

const preparedDatabase = Effect.fnUntraced(function* (config: ActivityStoreConfig) {
  yield* Effect.tryPromise({ try: prepareEngine, catch: (cause) => new ActivityUnreadable({ reason: String(cause) }) });
  selectEngine();
  if (config.database === ':memory:') return;
  const fs = yield* FileSystem.FileSystem;
  const marker = `${config.database}.baseline-reset`;
  const local = yield* Effect.try({
    try: () => readMigrationFiles({ migrationsFolder: config.migrations }),
    catch: (cause) => new ActivityUnreadable({ reason: String(cause) }),
  });
  let reset = yield* fs.exists(marker);
  if (!reset && (yield* fs.exists(config.database))) {
    const applied = yield* Effect.try({
      try: () => {
        const db = new Database(config.database, { readonly: true, create: false });
        try {
          const columns = db.query<{ name: string }, []>("select name from pragma_table_info('__drizzle_migrations')").all();
          if (columns.length === 0) return [];
          return db
            .query<{ name: string | null; hash: string }, []>(
              columns.some(({ name }) => name === 'name')
                ? 'select name, hash from __drizzle_migrations order by created_at, id'
                : 'select null as name, hash from __drizzle_migrations order by created_at, id',
            )
            .all();
        } finally {
          db.close();
        }
      },
      catch: (cause) => new ActivityUnreadable({ reason: String(cause) }),
    });
    const current = applied.every((row, at) => local[at]?.name === row.name && local[at]?.hash === row.hash);
    if (!current) {
      const receipt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(resetReceipt))(
        yield* fs.readFileString(join(config.migrations, 'baseline.json')),
      );
      if (
        applied.length > receipt.chain.length ||
        !applied.every((row, at) => receipt.chain[at]?.hash === row.hash && (row.name === null || receipt.chain[at]?.name === row.name))
      )
        return yield* new ActivityUnreadable({ reason: 'The activity migration ledger is not a prefix of the folded or shipped chain.' });
      yield* fs.writeFileString(marker, 'activity chain folded\n');
      reset = true;
    }
  }
  if (!reset) return;
  yield* fs.remove(config.bodies, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) yield* fs.remove(`${config.database}${suffix}`, { force: true });
  yield* fs.remove(marker, { force: true });
  console.log(`[activity] ${config.database}: the folded activity store and its bodies were removed`);
});

const opened = Effect.fnUntraced(function* (config: ActivityStoreConfig) {
  const db = yield* makeWithDefaults();
  yield* migrate(readMigrationFiles({ migrationsFolder: config.migrations }), db._.session);
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* EffectWorker.WorkerPlatform;
  const wake = yield* Latch.make(false);
  const writer = new Writer(wake, config.pendingMax ?? PENDING_CEILING);
  const lane = yield* Semaphore.make(1);
  const moved = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
  const bodies = new Bodies(
    config.bodies,
    writer,
    yield* Latch.make(false),
    yield* Latch.make(true),
    () => {
      const keeping = config.keeping();
      return Math.floor(keeping.bodiesMaxBytes / keeping.hours);
    },
    Math.floor(totalmem() / 64),
    lane,
  );
  const flushing = new Flushing(db, writer, bodies, config.projectsOf, lane, yield* Connections, moved);
  yield* Effect.forkScoped(bodies.serve(platform, yield* PreparedBodyWorker));
  yield* bodies.ready.pipe(Effect.timeout(SETTLE_DEADLINE), Effect.orDie);
  yield* orphaned(db);
  yield* Effect.forkScoped(bodies.loop());
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* wake.await;
        wake.closeUnsafe();
        yield* Effect.sleep(FLUSH_WINDOW);
        yield* flushing.flush;
        while (flushing.retryAt() !== null) {
          const now = yield* Clock.currentTimeMillis;
          yield* Effect.sleep(Duration.millis(Math.max(0, flushing.retryAt()! - now)));
          yield* flushing.flush;
        }
      }),
    ),
  );
  const aging = faultsAging(db, () => config.keeping().hours, lane, moved, yield* Clock.currentTimeMillis);
  const upkeep = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.flatMap(Effect.exit(Effect.andThen(aging(now), flushing.keep(fileSystem, config.bodies, config.keeping(), now))), (exit) =>
      Exit.isFailure(exit) ? Effect.logWarning('[activity] the upkeep pass did not finish', Cause.pretty(exit.cause)) : Effect.void,
    ),
  );
  yield* Effect.forkScoped(
    Effect.andThen(
      config.upkeepAfter ?? Effect.void,
      Effect.andThen(upkeep, Effect.forever(Effect.andThen(Effect.sleep(UPKEEP_INTERVAL), upkeep))),
    ),
  );
  yield* Effect.addFinalizer(() =>
    Effect.flatMap(flushing.shutdown, ({ unwritten }) =>
      Effect.sync(() => {
        if (unwritten > 0) console.error(`[activity] ${unwritten} facts were not written before the store closed`);
      }),
    ),
  );
  return Context.make(ActivityStore, ActivityStore.of({ log: flushing.log, settled: flushing.settled, health: flushing.health })).pipe(
    Context.add(
      ActivityRecord,
      activityReading(db, bodies, flushing.fresh, () => config.keeping().hours, lane, config.readingsMax ?? 256),
    ),
    Context.add(
      ActivityFaults,
      activityFaults(db, flushing.fresh, () => config.keeping().hours, lane, moved),
    ),
  );
});

const faultNote = (fact: ActivityFact): boolean => fact._tag === 'Noted' && (fact.note.type === 'defect' || fact.note.type === 'degraded');

class Flushing {
  private carried: readonly Lost[] = [];
  private resting = 0;
  private backoff = 0;
  private reason: string | null = null;
  private inventoried = false;
  private flying = 0;
  private closing = false;
  private stopped = false;
  private remainder = 0;
  private faulted = false;

  constructor(
    private readonly db: EffectSQLiteBunDatabase,
    private readonly writer: Writer,
    private readonly bodies: Bodies,
    private readonly projectsOf: ActivityStoreConfig['projectsOf'],
    private readonly lane: Semaphore.Semaphore,
    private readonly connections: Connections['Service'],
    private readonly moved: PubSub.PubSub<void>,
  ) {}

  readonly log: ActivityLog = {
    settled: Effect.suspend(() => this.acknowledged()).pipe(
      Effect.repeat({ while: () => this.writer.waiting() || this.carried.length > 0 }),
    ),
    record: (fact) => {
      if (fact._tag === 'Bodied') return this.bodies.offer(fact);
      if (faultNote(fact)) this.faulted = true;
      this.writer.push(fact);
    },
  };

  keep(fileSystem: Context.Service.Shape<typeof FileSystem.FileSystem>, root: string, keeping: Keeping, now: number) {
    return this.lane.withPermit(this.upkeep(fileSystem, root, keeping, now));
  }

  private readonly upkeep = Effect.fnUntraced(function* (
    this: Flushing,
    fileSystem: Context.Service.Shape<typeof FileSystem.FileSystem>,
    root: string,
    keeping: Keeping,
    now: number,
  ) {
    yield* this.fresh;
    yield* kept(this.db, fileSystem, root, this.bodies, keeping, now, !this.inventoried);
    this.inventoried = true;
  });

  retryAt(): number | null {
    return this.writer.waiting() || this.carried.length > 0 ? this.resting : null;
  }

  readonly health: Effect.Effect<ActivityHealth> = Effect.suspend(() =>
    Effect.map(this.connections.state, (state) => ({
      state: state === 'retired' || this.closing || this.stopped ? 'closed' : this.reason === null ? 'live' : 'degraded',
      ...this.writer.counts(),
      lost: this.carried,
      retryAt: this.retryAt(),
      reason: this.reason,
    })),
  );

  readonly fresh: Effect.Effect<ActivityFreshness> = Effect.andThen(
    Effect.suspend(() => this.drain()),
    Effect.sync(() => {
      const counts = this.writer.counts();
      return {
        lost: [
          ...this.carried.map((loss) => ({ ...loss, until: loss.until ?? loss.at })),
          ...(counts.pending + counts.dropped === 0
            ? []
            : [
                {
                  cause: 'pending',
                  unknown: true,
                  at: 0,
                  until: Number.MAX_SAFE_INTEGER,
                  facts: counts.pending + counts.dropped,
                  bodies: 0,
                  bytes: 0,
                },
              ]),
        ],
      };
    }),
  );

  readonly flush: Effect.Effect<void> = Effect.suspend(() => this.lane.withPermit(this.drain()));

  private readonly acknowledged = Effect.fnUntraced(function* (this: Flushing) {
    const now = yield* Clock.currentTimeMillis;
    if (this.resting > now) yield* Effect.sleep(this.resting - now);
    yield* this.flush;
    yield* this.bodies.settled;
    yield* this.flush;
  });

  readonly shutdown: Effect.Effect<ActivitySettlement> = Effect.suspend(() => {
    this.closing = true;
    this.writer.close();
    this.bodies.close();
    return Effect.tap(this.settled, ({ unwritten }) =>
      Effect.sync(() => {
        this.stopped = true;
        this.remainder = unwritten;
      }),
    );
  });

  readonly settled: Effect.Effect<ActivitySettlement> = Effect.suspend(() =>
    this.stopped ? Effect.succeed({ unwritten: this.remainder }) : this.settle(),
  ).pipe(Effect.uninterruptible);

  private readonly settle = Effect.fnUntraced(function* (this: Flushing) {
    const settling = yield* Effect.forkChild(
      this.flush.pipe(
        Effect.andThen(this.bodies.settled),
        Effect.andThen(Effect.sync(() => (this.resting = 0))),
        Effect.andThen(this.flush),
      ),
      { uninterruptible: false },
    );
    const done = yield* Effect.timeoutOption(Fiber.await(settling), SETTLE_DEADLINE);
    const carried = this.carried.reduce((sum, row) => sum + row.facts + row.bodies, 0);
    if (done._tag === 'Some') return { unwritten: carried };
    this.closing = true;
    this.writer.close();
    const bodies = this.bodies.stop();
    this.remainder = carried + this.flying + this.writer.unwritten() + bodies.bodies;
    const retired = yield* Effect.exit(this.connections.retire);
    if (Exit.isFailure(retired)) yield* Effect.logError('[activity] retiring its SQL connections failed', Cause.pretty(retired.cause));
    yield* Fiber.interrupt(settling);
    this.carried = merged([...this.carried, bodies]);
    this.stopped = true;
    return { unwritten: this.remainder };
  });

  private readonly drain = Effect.fnUntraced(function* (this: Flushing) {
    while (this.writer.waiting() || this.carried.length > 0) {
      const now = yield* Clock.currentTimeMillis;
      if (now < this.resting) return;
      const faulted = this.faulted;
      this.faulted = false;
      const batch = this.writer.take();
      this.flying = batch.facts + batch.lost.reduce((sum, row) => sum + row.facts + row.bodies, 0);
      const projects = yield* this.resolve(batch.opened);
      const losses = merged([...batch.lost, ...this.carried, ...projects.lost]);
      const exit = yield* Effect.exit(written(this.db, { ...batch, lost: losses }, projects.held));
      this.flying = 0;
      if (Exit.isSuccess(exit)) {
        this.carried = [];
        this.backoff = 0;
        this.resting = 0;
        this.reason = null;
        if (faulted) yield* PubSub.publish(this.moved, undefined);
        continue;
      }
      this.reason = Cause.pretty(exit.cause);
      if (this.backoff === 0) console.error('[activity] a batch of facts could not be written', this.reason);
      const unwritten: Lost = {
        _tag: 'Lost',
        cause: 'unwritten',
        at: batch.since ?? now,
        until: batch.until ?? now,
        facts: batch.facts,
        bodies: 0,
        bytes: 0,
      };
      const discarded = yield* Effect.result(
        this.bodies.discard(batch.stored.map((body) => ({ id: `${body.activity}.${body.n}`, bucket: body.bucket }))),
      );
      const unindexed: Lost[] =
        discarded._tag === 'Success'
          ? []
          : [
              {
                _tag: 'Lost',
                cause: 'unindexed-body',
                at: batch.since ?? now,
                until: batch.until ?? now,
                facts: 0,
                bodies: batch.stored.length,
                bytes: batch.stored.reduce((sum, body) => sum + body.bytes, 0),
              },
            ];
      if (discarded._tag === 'Failure') this.reason += `\nBody cleanup: ${discarded.failure.reason}`;
      this.carried = merged([...losses, unwritten, ...unindexed]);
      this.backoff = Math.min(Math.max(this.backoff * 2, 1_000), BACKOFF_CEILING_MS);
      this.resting = now + this.backoff;
      return;
    }
  });

  private resolve(
    opened: readonly ActivityOpened[],
  ): Effect.Effect<{ readonly held: ReadonlyMap<string, number | null>; readonly lost: readonly Lost[] }> {
    const threads = [...new Set(opened.flatMap((row) => (row.thread === null ? [] : [row.thread])))];
    if (threads.length === 0) return Effect.succeed({ held: new Map(), lost: [] });
    return Effect.flatMap(Effect.exit(this.projectsOf(threads)), (exit) => {
      if (Exit.isSuccess(exit)) {
        const missing = opened.filter((row) => row.thread !== null && !exit.value.has(row.thread));
        return Effect.succeed({
          held: exit.value,
          lost: missing.map((row): Lost => ({ _tag: 'Lost', cause: 'unattributed', at: row.at, facts: 1, bodies: 0, bytes: 0 })),
        });
      }
      return Effect.as(Effect.logWarning('[activity] the projects of the written threads are unknown', Cause.pretty(exit.cause)), {
        held: new Map<string, number | null>(),
        lost: opened
          .filter((row) => row.thread !== null)
          .map((row): Lost => ({ _tag: 'Lost', cause: 'unattributed', at: row.at, facts: 1, bodies: 0, bytes: 0 })),
      });
    });
  }
}

function merged(losses: readonly Lost[]): readonly Lost[] {
  const byCause = new Map<string, Lost>();
  for (const row of losses) {
    if (row.facts + row.bodies + row.bytes === 0 && row.unknown !== true) continue;
    const key = row.cause;
    const held = byCause.get(key);
    byCause.set(
      key,
      held === undefined
        ? row
        : {
            ...held,
            at: Math.min(held.at, row.at),
            until: Math.max(held.until ?? held.at, row.until ?? row.at),
            unknown: held.unknown === true || row.unknown === true,
            facts: held.facts + row.facts,
            bodies: held.bodies + row.bodies,
            bytes: held.bytes + row.bytes,
          },
    );
  }
  return [...byCause.values()];
}

function unavailable(database: string, reason: string): Context.Context<ActivityStore | ActivityRecord | ActivityFaults> {
  const failure = new ActivityUnreadable({
    reason: `The activity store at ${database} could not start: ${reason}. Its data was retained; repair the reported resource and open the store again.`,
  });
  console.error('[activity] the store is unavailable; its database was retained', failure.reason);
  let facts = 0;
  let bodies = 0;
  const lost = () => [{ cause: 'store-unavailable', facts, bodies, bytes: 0 }];
  const store = ActivityStore.of({
    log: {
      settled: Effect.void,
      record: (fact) => {
        if (fact._tag === 'Bodied') bodies += 1;
        else facts += 1;
      },
    },
    settled: Effect.sync(() => ({ unwritten: facts + bodies })),
    health: Effect.sync(() => ({
      state: 'degraded',
      pending: 0,
      dropped: facts + bodies,
      lost: lost(),
      retryAt: null,
      reason: failure.reason,
    })),
  });
  const failed = Effect.fail(failure);
  return Context.make(ActivityStore, store).pipe(
    Context.add(
      ActivityRecord,
      ActivityRecord.of({
        rows: () => failed,
        groups: () => failed,
        threads: () => failed,
        members: () => failed,
        activity: () => failed,
        body: () => failed,
      }),
    ),
    Context.add(ActivityFaults, ActivityFaults.of({ read: () => failed, clear: failed, changes: Stream.empty })),
  );
}
