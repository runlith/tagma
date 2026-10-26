import { Clock, Duration, Effect, Ref, type Scope } from 'effect';
import { noteWatchRound } from './hostTelemetry';
import type { ProgramRules } from './ProgramRules';
import { FACTS_CHUNK, ROUND_BUDGET, ROUND_PERIOD_MS, type ProcessTables, type ProvenSet, type TableReading } from './ProvenSet';

const monotonicMs: Effect.Effect<number> = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos) / 1_000_000);

export type WatchStatus = {
  readonly rounds: number;
  readonly delayed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly lastRoundMs: number | undefined;
  readonly longestRoundMs: number;
};

export type ProcessWatch = {
  readonly tables: ProcessTables;
  readonly status: Effect.Effect<WatchStatus>;
  readonly hold: (set: ProvenSet) => Effect.Effect<void, never, Scope.Scope>;
  readonly enforce: (set: ProvenSet, rules: ProgramRules) => Effect.Effect<void, never, Scope.Scope>;
  readonly follow: (follower: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>;
};

export type ProcessWatchInput = { readonly tables: ProcessTables; readonly periodMs?: number };

export const makeProcessWatch = Effect.fnUntraced(function* ({ tables, periodMs = ROUND_PERIOD_MS }: ProcessWatchInput) {
  const setsRef = yield* Ref.make<ReadonlySet<ProvenSet>>(new Set());
  const countedRef = yield* Ref.make<WatchStatus>({
    rounds: 0,
    delayed: 0,
    skipped: 0,
    failed: 0,
    lastRoundMs: undefined,
    longestRoundMs: 0,
  });
  const rulesRef = yield* Ref.make<ReadonlyMap<ProvenSet, ProgramRules>>(new Map());
  const followersRef = yield* Ref.make<ReadonlyArray<Effect.Effect<void>>>([]);
  function readStatus(): Effect.Effect<WatchStatus> {
    return Ref.get(countedRef);
  }

  function hold(set: ProvenSet): Effect.Effect<void, never, Scope.Scope> {
    return Effect.asVoid(
      Effect.acquireRelease(
        Ref.update(setsRef, (held) => new Set(held).add(set)),
        () =>
          Ref.update(setsRef, (held) => {
            const next = new Set(held);
            next.delete(set);
            return next;
          }),
      ),
    );
  }

  function enforce(set: ProvenSet, rules: ProgramRules): Effect.Effect<void, never, Scope.Scope> {
    return Effect.asVoid(
      Effect.acquireRelease(
        Ref.update(rulesRef, (held) => new Map(held).set(set, rules)),
        () =>
          Ref.update(rulesRef, (held) => {
            const next = new Map(held);
            next.delete(set);
            return next;
          }),
      ),
    );
  }

  function follow(follower: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope> {
    return Effect.asVoid(
      Effect.acquireRelease(
        Ref.update(followersRef, (held) => [...held, follower]),
        () => Ref.update(followersRef, (held) => held.filter((standing) => standing !== follower)),
      ),
    );
  }

  const loop = Effect.fnUntraced(function* (periodMs: number): Effect.fn.Return<never> {
    let due = yield* monotonicMs;
    for (;;) {
      const now = yield* monotonicMs;
      if (now < due) yield* Effect.sleep(Duration.millis(due - now));
      const began = yield* monotonicMs;
      const answered = yield* Effect.catchDefect(round(), (defect) =>
        Effect.as(Effect.logError('a process watch round died', defect), 'failed' as const),
      );
      const ended = yield* monotonicMs;
      const next = began + periodMs;
      const delayed = ended > next;
      const skipped = delayed ? Math.floor((ended - next) / periodMs) : 0;
      due = delayed ? ended : next;
      if (answered === 'idle') continue;
      const took = ended - began;
      const failed = answered === 'failed';
      yield* Ref.update(countedRef, (held) => ({
        rounds: held.rounds + 1,
        delayed: held.delayed + (delayed ? 1 : 0),
        skipped: held.skipped + skipped,
        failed: held.failed + (failed ? 1 : 0),
        lastRoundMs: took,
        longestRoundMs: Math.max(held.longestRoundMs, took),
      }));
      yield* noteWatchRound({ took, delayed, skipped, failed });
    }
  });

  const round = Effect.fnUntraced(function* (): Effect.fn.Return<'read' | 'failed' | 'idle'> {
    const sets: ProvenSet[] = [];
    const ended = new Set<ProvenSet>();
    for (const set of yield* Ref.get(setsRef)) {
      if (yield* set.taken) ended.add(set);
      else sets.push(set);
    }
    if (ended.size > 0) yield* Ref.update(setsRef, (held) => new Set([...held].filter((set) => !ended.has(set))));
    if (sets.length === 0) return 'idle';
    return yield* tables.read().pipe(
      Effect.matchEffect({
        onFailure: () =>
          Effect.as(
            Effect.forEach(sets, (set) => set.failed(), { discard: true }),
            'failed' as const,
          ),
        onSuccess: Effect.fnUntraced(function* (table: TableReading) {
          const atMs = Number(table.atNanos) / 1_000_000;
          const grown: ProvenSet[] = [];
          for (const set of sets) if (yield* set.grow(table)) grown.push(set);
          const due: Array<readonly [ProvenSet, number, number]> = [];
          for (const set of grown) for (const [pid, at] of yield* set.due()) due.push([set, pid, at]);
          due.sort((left, right) => left[2] - right[2]);
          const budgeted = new Map<ProvenSet, number[]>();
          for (const [set, pid] of due.slice(0, ROUND_BUDGET)) {
            const pids = budgeted.get(set);
            if (pids === undefined) budgeted.set(set, [pid]);
            else pids.push(pid);
          }
          const failing = new Set<ProvenSet>();
          let chunks = 0;
          for (const [set, pids] of budgeted) {
            for (let at = 0; at < pids.length; at += FACTS_CHUNK) {
              if (chunks > 0) yield* Effect.yieldNow;
              chunks += 1;
              if ((yield* set.refresh(pids.slice(at, at + FACTS_CHUNK), atMs)) === 'failed') failing.add(set);
            }
          }
          const rules = yield* Ref.get(rulesRef);
          for (const set of grown) {
            const bound = rules.get(set);
            if (bound === undefined || failing.has(set)) continue;
            const died = yield* Effect.catchDefect(Effect.as(bound.round(atMs), false), (defect) =>
              Effect.as(Effect.logError('a program rule round died', defect), true),
            );
            if (died) failing.add(set);
          }
          for (const follower of yield* Ref.get(followersRef))
            yield* Effect.catchDefect(follower, (defect) => Effect.logError('a process watch follower died', defect));
          return failing.size > 0 ? ('failed' as const) : ('read' as const);
        }),
      }),
    );
  });
  yield* Effect.forkScoped(loop(periodMs));
  return {
    tables: tables,
    get status() {
      return readStatus();
    },
    hold: hold,
    enforce: enforce,
    follow: follow,
  } satisfies ProcessWatch;
});
