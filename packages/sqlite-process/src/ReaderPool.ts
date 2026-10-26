import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import type { SqlError } from 'effect/sql/SqlError';
import type { ProcessConnection, StatementTiming } from './connection.js';
import { ReaderLanes, type ReadClass } from './ReaderLanes.js';

export type OpenReader = (onLost: (reason: string) => void, lane: number) => Effect.Effect<ProcessConnection, SqlError, Scope.Scope>;

export type PoolState = {
  readonly standing: number;
  readonly idle: number;
  readonly queued: number;
  readonly bulkQueued: number;
  readonly lost: number;
  readonly unopened: number;
  readonly closedIdle: number;
  readonly statements: number;
  readonly execMs: number;
  readonly queueMs: number;
  readonly maxExecMs: number;
  readonly maxQueueMs: number;
};

export const READER_IDLE_MS = 60_000;

type Standing = { readonly scope: Scope.Closeable; readonly lane: number; freedAt: number };

export const bulkCeiling = (ceiling: number): number => (ceiling < 2 ? ceiling : ceiling - Math.max(1, Math.floor(ceiling / 4)));

export type ReaderPool = {
  readonly take: Effect.Effect<ProcessConnection, SqlError>;
  readonly takeBulk: Effect.Effect<ProcessConnection, SqlError>;
  readonly connections: readonly ProcessConnection[];
  readonly state: PoolState;
  readonly noteStatement: (timing: StatementTiming) => void;
};

export type ReaderPoolOptions = {
  readonly ceiling: number;
  readonly open: OpenReader;
  readonly lanes?: ReaderLanes;
};

export const makeReaderPool = Effect.fnUntraced(function* ({
  ceiling,
  open,
  lanes: given,
}: ReaderPoolOptions): Effect.fn.Return<ReaderPool, never, Scope.Scope> {
  const held = yield* Effect.scope;
  const lanes = given ?? new ReaderLanes(ceiling);
  const bulkCap = bulkCeiling(ceiling);
  const standing = new Map<ProcessConnection, Standing>();
  const free: ProcessConnection[] = [];
  const waiting: Record<ReadClass, Array<Deferred.Deferred<void>>> = { point: [], bulk: [] };
  let claimed = 0;
  let bulkClaimed = 0;
  let sweeping = false;
  let lost = 0;
  let unopened = 0;
  let closedIdle = 0;
  let statements = 0;
  let execMs = 0;
  let queueMs = 0;
  let maxExecMs = 0;
  let maxQueueMs = 0;

  const admits = (kind: ReadClass): boolean => {
    if (waiting.point.length > 0 || claimed >= ceiling) return false;
    return kind === 'point' || (waiting.bulk.length === 0 && bulkClaimed < bulkCap);
  };

  const handOn = (released: ReadClass): void => {
    if (released === 'bulk') bulkClaimed -= 1;
    const point = waiting.point.shift();
    if (point !== undefined) {
      Deferred.doneUnsafe(point, Effect.void);
      return;
    }
    if (bulkClaimed < bulkCap) {
      const bulk = waiting.bulk.shift();
      if (bulk !== undefined) {
        bulkClaimed += 1;
        Deferred.doneUnsafe(bulk, Effect.void);
        return;
      }
    }
    claimed -= 1;
  };

  const withdraw = (turn: Deferred.Deferred<void>, kind: ReadClass): void => {
    const queue = waiting[kind];
    const place = queue.indexOf(turn);
    if (place !== -1) {
      queue.splice(place, 1);
      return;
    }
    handOn(kind);
  };

  const booked = (
    restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
    kind: ReadClass,
    busy: number,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (admits(kind)) {
        claimed += 1;
        if (kind === 'bulk') bulkClaimed += 1;
        return Effect.annotateCurrentSpan({ 'db.readers.queued': 0, 'db.readers.busy': busy });
      }
      const turn = Deferred.makeUnsafe<void>();
      const queue = waiting[kind];
      queue.push(turn);
      return Effect.flatMap(
        Effect.annotateCurrentSpan({ 'db.readers.queued': queue.length, 'db.readers.busy': busy, 'db.readers.class': kind }),
        () =>
          Effect.onInterrupt(Effect.withSpan(restore(Deferred.await(turn)), 'sqlite.reader.wait'), () =>
            Effect.sync(() => withdraw(turn, kind)),
          ),
      );
    });

  const drop = (dead: ProcessConnection): void => {
    standing.delete(dead);
    const idle = free.indexOf(dead);
    if (idle !== -1) free.splice(idle, 1);
  };

  const opened = Effect.fnUntraced(
    function* (kind: ReadClass, lane: number, release: () => void) {
      const own = yield* Scope.fork(held);
      const born: { reader?: ProcessConnection; lost: boolean } = { lost: false };
      const fresh = yield* Effect.onError(
        Effect.provideService(
          open(() => {
            born.lost = true;
            lost += 1;
            if (born.reader !== undefined) drop(born.reader);
          }, lane),
          Scope.Scope,
          own,
        ),
        (cause) => Scope.close(own, Exit.failCause(cause)),
      );
      born.reader = fresh;
      if (!born.lost) standing.set(fresh, { scope: own, lane, freedAt: 0 });
      yield* Effect.annotateCurrentSpan({ 'db.reader.pid': fresh.pid });
      return fresh;
    },
    (effect, kind, _lane, release) =>
      Effect.onError(effect, () =>
        Effect.sync(() => {
          unopened += 1;
          release();
          handOn(kind);
        }),
      ),
  );

  const sweepIdle = (): Effect.Effect<void> => {
    if (sweeping || free.length === 0 || standing.size <= 1) return Effect.void;
    sweeping = true;
    return Effect.asVoid(
      Effect.forkIn(
        Effect.gen(function* () {
          for (;;) {
            const oldest = free[0];
            if (oldest === undefined || standing.size <= 1) return;
            const freedAt = standing.get(oldest)?.freedAt ?? 0;
            const due = freedAt + READER_IDLE_MS - (yield* Clock.currentTimeMillis);
            if (due > 0) {
              yield* Effect.sleep(due);
              continue;
            }
            free.shift();
            const closing = standing.get(oldest);
            standing.delete(oldest);
            closedIdle += 1;
            if (closing !== undefined) yield* Scope.close(closing.scope, Exit.void);
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              sweeping = false;
            }),
          ),
        ),
        held,
      ),
    );
  };

  const giveBack = (taken: ProcessConnection, kind: ReadClass, release: () => void): Effect.Effect<void> =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.suspend(() => {
        const entry = standing.get(taken);
        if (entry !== undefined) {
          entry.freedAt = now;
          free.push(taken);
        }
        release();
        handOn(kind);
        return sweepIdle();
      }),
    );

  const taking = (kind: ReadClass): Effect.Effect<ProcessConnection, SqlError> =>
    Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = Context.getUnsafe(fiber.context, Scope.Scope);
      return Effect.suspend(() => {
        const busy = standing.size - free.length;
        return Effect.flatMap(booked(restore, kind, busy), () =>
          Effect.flatMap(
            Effect.onInterrupt(restore(lanes.take(kind)), () => Effect.sync(() => handOn(kind))),
            ({ lane, release }) =>
              Effect.suspend(() => {
                const at = free.findIndex((reader) => standing.get(reader)?.lane === lane);
                const idle = at === -1 ? undefined : free.splice(at, 1)[0];
                const reader = idle === undefined ? opened(kind, lane, release) : Effect.succeed(idle);
                return Effect.tap(reader, (taken) => Scope.addFinalizer(scope, giveBack(taken, kind, release)));
              }),
          ),
        );
      });
    });

  return {
    take: taking('point'),
    takeBulk: taking('bulk'),
    get connections() {
      return [...standing.keys()];
    },
    get state() {
      return {
        standing: standing.size,
        idle: free.length,
        queued: waiting.point.length + waiting.bulk.length,
        bulkQueued: waiting.bulk.length,
        lost,
        unopened,
        closedIdle,
        statements,
        execMs,
        queueMs,
        maxExecMs,
        maxQueueMs,
      };
    },
    noteStatement: (timing) => {
      statements += 1;
      execMs += timing.execMs;
      queueMs += timing.queueMs;
      maxExecMs = Math.max(maxExecMs, timing.execMs);
      maxQueueMs = Math.max(maxQueueMs, timing.queueMs);
    },
  };
});
