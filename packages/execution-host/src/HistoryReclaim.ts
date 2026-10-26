import { Clock, Effect, Latch, Ref, type Scope } from 'effect';
import type { ExecutionId } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity, capacityState, type CapacityState } from './ExecutionCapacity';
import type { Interpretation } from './Interpretation';
import type { Presentation } from './Presentation';
import { countReclaimed, noteMemory, reportDeadFiber } from './hostTelemetry';

export type ReclaimCandidate = {
  readonly execution: ExecutionId;
  readonly retained: number;
  readonly watched: boolean;
  readonly activeAt: number;
};

export type ReclaimTaken = {
  readonly execution: ExecutionId;
  readonly rows: number;
  readonly bytes: number;
};

export type ReclaimPass = {
  readonly trimmed: ReadonlyArray<ReclaimTaken>;
  readonly standing: CapacityState;
};

const reclaimOrder = (candidates: ReadonlyArray<ReclaimCandidate>): ReadonlyArray<ReclaimCandidate> =>
  candidates
    .filter((candidate) => candidate.retained > 0)
    .sort((left, right) => {
      if (left.watched !== right.watched) return left.watched ? 1 : -1;
      if (left.activeAt !== right.activeAt) return left.activeAt - right.activeAt;
      return left.execution < right.execution ? -1 : 1;
    });

type TrimmedHistory = { readonly rows: number; readonly bytes: number; readonly standing: CapacityState };

type Held = {
  readonly interpretation: Interpretation;
  readonly presentation: Presentation | undefined;
  readonly activeAt: number;
};

export type HistoryReclaim = {
  readonly hold: (
    execution: ExecutionId,
    interpretation: Interpretation,
    presentation: Presentation | undefined,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly touch: (execution: ExecutionId) => Effect.Effect<void>;
  readonly measure: (execution: ExecutionId, retained?: number) => Effect.Effect<void>;
  readonly wake: () => Effect.Effect<void>;
  readonly reclaim: () => Effect.Effect<ReclaimPass>;
};

export const makeHistoryReclaim = Effect.gen(function* () {
  const heldRef = yield* Ref.make<ReadonlyMap<ExecutionId, Held>>(new Map());
  const latch = yield* Latch.make(false);
  const capacity = yield* ExecutionCapacity;
  function hold(
    execution: ExecutionId,
    interpretation: Interpretation,
    presentation: Presentation | undefined,
  ): Effect.Effect<void, never, Scope.Scope> {
    return Effect.asVoid(
      Effect.acquireRelease(
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.update(heldRef, (kept) => new Map(kept).set(execution, { interpretation, presentation, activeAt: now })),
        ),
        () =>
          Ref.update(heldRef, (kept) => {
            const next = new Map(kept);
            next.delete(execution);
            return next;
          }),
      ),
    );
  }

  function touch(execution: ExecutionId): Effect.Effect<void> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Ref.update(heldRef, (kept) => {
        const found = kept.get(execution);
        return found === undefined ? kept : new Map(kept).set(execution, { ...found, activeAt: now });
      }),
    );
  }

  const measure = Effect.fnUntraced(function* (execution: ExecutionId, retained?: number): Effect.fn.Return<void> {
    const found = (yield* Ref.get(heldRef)).get(execution);
    if (found === undefined) return;
    const measured = retained ?? (yield* found.interpretation.retained());
    const standing = yield* capacity.measure(execution, measured);
    yield* noteMemory(standing.reserved, standing.retained);
    if (standing.over > 0) yield* wake();
  });

  function wake(): Effect.Effect<void> {
    return Effect.asVoid(latch.open);
  }

  const reclaim = Effect.fnUntraced(function* (): Effect.fn.Return<ReclaimPass> {
    const account = yield* capacity.account();
    const grant = account.granted.grantBytes;
    const cap = capacity.profile.execution.parser.cellBytes;
    let standing = capacityState(account);
    const trimmed: ReclaimTaken[] = [];
    if (standing.over === 0) {
      yield* noteMemory(standing.reserved, standing.retained);
      return { trimmed, standing } satisfies ReclaimPass;
    }
    const kept = yield* Ref.get(heldRef);
    const order = reclaimOrder(
      [...kept].map(([execution, found]) => ({
        execution,
        retained: account.measured.get(execution) ?? 0,
        watched: (account.reservations.get(execution)?.readers ?? 0) > 0,
        activeAt: found.activeAt,
      })),
    );
    for (const candidate of order) {
      if (standing.retained <= mark(grant, standing.reserved, cap)) break;
      const found = kept.get(candidate.execution);
      if (found === undefined) continue;
      const taken = yield* take(candidate, found, grant, cap, standing);
      standing = taken.standing;
      if (taken.rows > 0) {
        trimmed.push({ execution: candidate.execution, rows: taken.rows, bytes: taken.bytes });
        yield* countReclaimed(taken.rows, taken.bytes);
        if (found.presentation !== undefined) yield* found.presentation.invalidate();
      }
    }
    yield* noteMemory(standing.reserved, standing.retained);
    return { trimmed, standing } satisfies ReclaimPass;
  });

  const take = Effect.fnUntraced(function* (
    candidate: ReclaimCandidate,
    found: Held,
    grant: number,
    cap: number,
    from: CapacityState,
  ): Effect.fn.Return<TrimmedHistory> {
    let standing = from;
    let holding = candidate.retained;
    let rows = 0;
    let bytes = 0;
    for (;;) {
      const target = mark(grant, standing.reserved, cap);
      if (standing.retained <= target || holding <= 0) break;
      const history = yield* found.interpretation.historyRows();
      if (history === 0) break;
      const asked = Math.min(history, Math.max(1, Math.ceil((standing.retained - target) / (holding / history))));
      const dropped = yield* found.interpretation.trim(asked);
      if (dropped === 0) break;
      const before = standing.retained;
      holding = yield* found.interpretation.retained();
      standing = yield* capacity.measure(candidate.execution, holding);
      rows += dropped;
      bytes += Math.max(0, before - standing.retained);
    }
    return { rows, bytes, standing };
  });

  const run = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    for (;;) {
      yield* latch.await;
      yield* latch.close;
      yield* reclaim();
    }
  });
  yield* Effect.forkScoped(reportDeadFiber('history-reclaim', run()));
  return { hold: hold, touch: touch, measure: measure, wake: wake, reclaim: reclaim } satisfies HistoryReclaim;
});

const mark = (grant: number, reserved: number, cap: number): number => Math.max(0, grant - reserved - cap);
