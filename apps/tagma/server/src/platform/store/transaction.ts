import type { StatementTiming } from '@runlith/sqlite-process/connection';
import { carryCost, CurrentCost, rootCost } from '@runlith/performance/CostLedger';
import { CurrentWriter, type WriterMetrics } from '@runlith/performance/WriterMetrics';
import { Cause, Clock, Context, Effect, Exit, Fiber, Tracer } from 'effect';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import {
  type StoreBrand,
  type StoreFailure,
  type StoreIdentity,
  type StoreTransactionOptions,
  WRITER_BUDGET_MS,
} from '../contract/service/store.js';
import { HeldFor } from '@runlith/held/holding';
import { synchronously } from '@runlith/sqlite-process/SqliteProcess';
import { type WriteUnit, writeUnitOf } from '../contract/service/units.js';
import { UnitWriteRefused, type WriteSet } from '../contract/service/writes.js';
import { LateStatementRefused, ProgramOpen, UnitEnd, UnitInProgramRefused, UnitLife } from './life.js';
import type { DurabilityClass } from '../contract/service/durability.js';
import { breach, movedTables, UnitDurability, UnitWrites } from './writes.js';
import type { TableMoves } from './moves.js';

type TimingWindow = {
  readonly statements: number;
  readonly execMs: number;
  readonly queueMs: number;
  readonly totalMs: number;
  readonly maxExecMs: number;
  readonly maxQueueMs: number;
};

type TimingFrame = { -readonly [K in keyof TimingWindow]: TimingWindow[K] };

export const UnitOpen = Context.Reference<boolean>('tagma/platform/UnitOpen', { defaultValue: () => false });
export const UnitStore = Context.Reference<StoreIdentity | null>('tagma/platform/UnitStore', { defaultValue: () => null });
type CommitQueue = {
  readonly store: StoreIdentity;
  readonly queued: Effect.Effect<void>[];
  readonly moved: (ReadonlySet<string> | null)[];
  readonly end: UnitEnd;
  body: Context.Context<never>;
};
const CommitQueue = Context.Reference<CommitQueue | null>('tagma/platform/CommitQueue', { defaultValue: () => null });

const callerOwn = <R>(site: Context.Context<R>, body: Context.Context<never>): Context.Context<R> =>
  Context.omit(
    Tracer.ParentSpan,
    UnitOpen,
    UnitStore,
    CommitQueue,
    UnitWrites,
    UnitDurability,
    UnitLife,
  )(Context.makeUnsafe<R>(new Map([...site.mapUnsafe].filter(([key, value]) => body.mapUnsafe.get(key) !== value)))) as Context.Context<R>;

export class WriterTimings {
  private readonly open = new Set<TimingFrame>();

  note(timing: StatementTiming): void {
    if (timing.source === 'reader') return;
    for (const frame of this.open) {
      frame.statements += 1;
      if (timing.enclosed === true) continue;
      frame.execMs += timing.execMs;
      frame.queueMs += timing.queueMs;
      frame.totalMs += timing.totalMs;
      frame.maxExecMs = Math.max(frame.maxExecMs, timing.execMs);
      frame.maxQueueMs = Math.max(frame.maxQueueMs, timing.queueMs);
    }
  }

  begin(): TimingFrame {
    const frame = { statements: 0, execMs: 0, queueMs: 0, totalMs: 0, maxExecMs: 0, maxQueueMs: 0 };
    this.open.add(frame);
    return frame;
  }

  end(frame: TimingFrame): TimingWindow {
    this.open.delete(frame);
    return frame;
  }
}

const writerVerdict = (window: TimingWindow): Record<string, number> => ({
  'db.writer.statements': window.statements,
  'db.writer.execMs': rounded(window.execMs),
  'db.writer.queueMs': rounded(window.queueMs),
  'db.writer.totalMs': rounded(window.totalMs),
  'db.writer.maxExecMs': rounded(window.maxExecMs),
  'db.writer.maxQueueMs': rounded(window.maxQueueMs),
});

const rounded = (ms: number): number => Math.round(ms * 100) / 100;

export const storeTransaction =
  <Brand extends StoreBrand>(
    db: EffectSQLiteBunDatabase,
    timings: WriterTimings,
    identity: StoreIdentity,
    moves: TableMoves,
    classed = false,
    metrics?: WriterMetrics['Service'],
  ) =>
  <A, E, R, RCommit = never>(
    declared: WriteSet | string,
    body: (unit: WriteUnit<Brand>) => Effect.Effect<A, E, R>,
    options: StoreTransactionOptions<A, RCommit> = {},
  ): Effect.Effect<A, E | StoreFailure, R | RCommit> => {
    const operation = typeof declared === 'string' ? declared : declared.operation;
    const set = typeof declared === 'string' ? null : declared;
    const durability = set?.durability ?? 'durable';
    return rootCost(
      operation,
      Effect.uninterruptibleMask((restore) =>
        Effect.useSpan('Store.transaction', { attributes: { opKind: operation } }, (parent) => {
          let owned: UnitEnd | null = null;
          return Effect.gen(function* () {
            const building = yield* ProgramOpen;
            if (building !== null && building.store.path === identity.path && building.store.generation === identity.generation)
              return yield* Effect.die(new UnitInProgramRefused({ store: identity.path, operation }));
            const cost = yield* CurrentCost;
            if (cost !== null) cost.counts.units++;
            const attributes = { opKind: operation };
            const enclosing = yield* UnitWrites;
            const durabilities = yield* UnitDurability;
            const physical = durabilities.get(identity);
            const nested = physical !== undefined;
            const writer = nested ? yield* CurrentWriter : (metrics?.begin(operation, identity.path) ?? null);
            const writing = new Map(enclosing).set(identity, set);
            const lasting = nested ? durabilities : new Map(durabilities).set(identity, durability);
            if (nested && durability === 'durable' && physical === 'relaxed') {
              yield* breach(identity, new UnitWriteRefused({ store: identity.path, operation, table: null, reason: 'durable-in-relaxed' }));
            }
            const wait = yield* Effect.makeSpan('Store.permit.wait', { parent, attributes });
            let settlementSpan: Tracer.Span | undefined;
            let heldFrom = 0;
            let bodyWindow: TimingWindow | undefined;
            let settleWindow: TimingWindow | undefined;
            let settling: TimingFrame | undefined;
            const outer = yield* CommitQueue;
            const joined = outer !== null && outer.store.path === identity.path && outer.store.generation === identity.generation;
            const end = joined ? outer.end : (owned = new UnitEnd());
            const commits: CommitQueue = { store: identity, queued: [], moved: [], end, body: Context.empty() };
            end.release(() => void commits.queued.splice(0));
            const life: UnitLife = { identity, operation, open: true };
            const value = yield* db
              .transaction(() =>
                Effect.gen(function* () {
                  yield* endSpan(wait, Exit.void);
                  heldFrom = performance.now();
                  const running = timings.begin();
                  return yield* restore(
                    Effect.flatMap(Effect.context<never>(), (held) => {
                      commits.body = held;
                      return body(heldUnit<Brand>(held, identity, commits, writing, lasting, life)).pipe(
                        Effect.provideService(UnitOpen, true),
                        Effect.provideService(CommitQueue, commits),
                        Effect.provideService(UnitWrites, writing),
                        Effect.provideService(UnitDurability, lasting),
                        Effect.provideService(UnitLife, life),
                        Effect.forkChild({ startImmediately: true }),
                        Effect.flatMap((running) => Effect.onInterrupt(Fiber.join(running), () => Fiber.interrupt(running))),
                      );
                    }),
                  ).pipe(
                    Effect.ensuring(Effect.sync(() => void (life.open = false))),
                    Effect.onExit(() =>
                      Effect.flatMap(
                        Effect.sync(() => {
                          bodyWindow = timings.end(running);
                          settling = timings.begin();
                          return bodyWindow;
                        }),
                        (body) => Effect.annotateCurrentSpan(writerVerdict(body)),
                      ),
                    ),
                    Effect.withSpan('Store.execute', { parent, attributes }),
                    Effect.onExit((exit) =>
                      Effect.map(
                        Effect.makeSpan(Exit.isSuccess(exit) ? `Store.${options.settlement ?? 'commit'}` : 'Store.rollback', {
                          parent,
                          attributes,
                        }),
                        (span) => {
                          settlementSpan = span;
                        },
                      ),
                    ),
                  );
                }),
              )
              .pipe(
                Effect.onExit((exit) =>
                  Effect.flatMap(
                    Effect.sync(() => {
                      if (settling !== undefined) settleWindow = timings.end(settling);
                      return settleWindow;
                    }),
                    (window) =>
                      Effect.all(
                        [
                          wait.status._tag === 'Started' ? endSpan(wait, exit) : Effect.void,
                          settlementSpan === undefined || window === undefined ? Effect.void : endSettlement(settlementSpan, window, exit),
                        ],
                        { discard: true },
                      ),
                  ),
                ),
                Effect.onExit(() => reportIfOverBudget(operation, identity.path, heldFrom, bodyWindow, settleWindow)),
                (settled) => (classed ? synchronously(durability === 'relaxed' ? 'normal' : 'full')(settled) : settled),
                Effect.provideService(HeldFor, operation),
                Effect.provideService(CurrentWriter, writer),
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    if (!nested && writer !== null && metrics !== undefined) {
                      metrics.end(
                        writer,
                        Exit.isSuccess(exit) ? 'success' : Cause.hasInterruptsOnly(exit.cause) ? 'interrupted' : 'failure',
                      );
                    }
                  }),
                ),
              );
            const onCommit = options.onCommit;
            const publication = onCommit === undefined ? undefined : Effect.suspend(() => onCommit(value));
            const moved = [movedTables(identity, set), ...commits.moved];
            if (joined) {
              const own = callerOwn(yield* Effect.context<RCommit>(), outer.body);
              outer.moved.push(...moved);
              outer.queued.push(...commits.queued.map((queued) => Effect.provideContext(queued, own)));
              if (publication !== undefined) outer.queued.push(Effect.provideContext(publication, own));
              return value;
            }
            for (const tables of moved) moves.committed(tables);
            const tails: Effect.Effect<void, never, RCommit>[] =
              publication === undefined ? commits.queued : [...commits.queued, publication];
            let lost = Cause.empty as Cause.Cause<never>;
            for (const tail of tails) {
              const ended = yield* Effect.exit(tail);
              if (Exit.isFailure(ended)) lost = Cause.combine(lost, ended.cause);
            }
            if (lost.reasons.length > 0) return yield* Effect.failCause(lost);
            return value;
          }).pipe(Effect.withParentSpan(parent), Effect.ensuring(Effect.sync(() => owned?.close())));
        }),
      ),
    );
  };

export const withinCommit = <A, E, R>(
  moved: ReadonlySet<string> | null,
  work: (tails: Effect.Effect<void>[], end: UnitEnd) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.all([CommitQueue, UnitLife]), ([outer, life]) => {
    if (outer === null || life === null || !life.open)
      return Effect.die(
        new LateStatementRefused({ store: life?.identity.path ?? outer?.store.path ?? '', operation: life?.operation ?? '' }),
      );
    const inner: CommitQueue = { store: outer.store, queued: [], moved: [], end: outer.end, body: outer.body };
    outer.end.release(() => void inner.queued.splice(0));
    return Effect.tap(Effect.provideService(work(inner.queued, outer.end), CommitQueue, inner), () =>
      life.open
        ? Effect.sync(() => {
            outer.queued.push(...inner.queued);
            outer.moved.push(moved, ...inner.moved);
          })
        : Effect.die(new LateStatementRefused({ store: life.identity.path, operation: life.operation })),
    );
  });

const heldUnit = <Brand extends StoreBrand>(
  held: Context.Context<never>,
  identity: StoreIdentity,
  commits: CommitQueue,
  writing: ReadonlyMap<StoreIdentity, WriteSet | null>,
  lasting: ReadonlyMap<StoreIdentity, DurabilityClass>,
  life: UnitLife,
): WriteUnit<Brand> => {
  const context = Context.add(
    Context.add(
      Context.add(Context.add(Context.add(held, UnitStore, identity), UnitOpen, true), UnitWrites, writing),
      UnitDurability,
      lasting,
    ),
    UnitLife,
    life,
  );
  const services = Context.omit(CurrentCost)(context);
  return commits.end.bind(
    writeUnitOf<Brand>({
      store: identity,
      run: <A>(query: Effect.Effect<A, StoreFailure>) => Effect.provide(query, services),
      afterCommit: (effect: Effect.Effect<void>) =>
        Effect.suspend(() =>
          life.open
            ? Effect.sync(() => void commits.queued.push(carryCost(effect)))
            : Effect.die(new LateStatementRefused({ store: identity.path, operation: life.operation })),
        ),
    }),
  );
};

const reportIfOverBudget = (
  operation: string,
  path: string,
  heldFrom: number,
  bodyWindow: TimingWindow | undefined,
  settleWindow: TimingWindow | undefined,
): Effect.Effect<void> =>
  heldFrom === 0
    ? Effect.void
    : Effect.sync(() => {
        const now = performance.now();
        if (now - heldFrom < WRITER_BUDGET_MS) return;
        const statements = (bodyWindow?.statements ?? 0) + (settleWindow?.statements ?? 0);
        const execMs = (bodyWindow?.execMs ?? 0) + (settleWindow?.execMs ?? 0);
        const queueMs = (bodyWindow?.queueMs ?? 0) + (settleWindow?.queueMs ?? 0);
        const outsideMs = Math.max(0, now - heldFrom - (bodyWindow?.totalMs ?? 0) - (settleWindow?.totalMs ?? 0));
        console.warn(
          `[tagma] ${path}: a ${operation} transaction held the writer ${((now - heldFrom) / 1000).toFixed(1)}s ` +
            `— ${statements} statement(s), engine ${Math.round(execMs)}ms, queue ${Math.round(queueMs)}ms, ` +
            `outside sqlite ${(outsideMs / 1000).toFixed(1)}s; every other writer of this database waited on it`,
        );
      });

const endSpan = (span: Tracer.Span, exit: Exit.Exit<unknown, unknown>): Effect.Effect<void> =>
  span.status._tag === 'Ended' ? Effect.void : Effect.map(Clock.currentTimeNanos, (endTime) => span.end(endTime, exit));

const endSettlement = (span: Tracer.Span, window: TimingWindow, exit: Exit.Exit<unknown, unknown>): Effect.Effect<void> =>
  Effect.andThen(
    Effect.sync(() => {
      for (const [key, value] of Object.entries(writerVerdict(window))) span.attribute(key, value);
    }),
    endSpan(span, exit),
  );
