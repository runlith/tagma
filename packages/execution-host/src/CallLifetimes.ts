import { Data, Clock, Deferred, Duration, Effect, Fiber, Ref, Scope, Semaphore } from 'effect';
import type { CallBudget, CallDecision, CallDecisionAnswer, CancellationCause, SourceCompletion } from '@runlith/executions/protocol/call';
import type { CommandRevisionRequest, LimitProvenance, DeadlineChange, RevisionRefusal } from '@runlith/executions/protocol/command';
import type { Cleanup, ExecutionRef, NativeExit, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { CallRetention } from '@runlith/executions/protocol/call';
import type { ProcessCost } from '@runlith/executions/protocol/execution';
import { ByteOffset, byteOffset } from '@runlith/executions/protocol/record';
import { ExecutionStore } from './store/ExecutionStore';
import type { CallRecord, CallTiming, CommandRevisionRecord } from './db/persisted';

export class CallMissing extends Data.TaggedError('CallMissing')<{ readonly operation: string }> {
  override get message(): string {
    return `no call ${this.operation} is open`;
  }
}

export type SourceState = { readonly completed: boolean; readonly offset: ByteOffset };

export class CallNotRecorded extends Data.TaggedError('CallNotRecorded')<{ readonly operation: string; readonly cause: string }> {
  override get message(): string {
    return `call ${this.operation} could not be recorded: ${this.cause}`;
  }
}

type CallState = {
  readonly operation: HostRequestRef;
  readonly execution: ExecutionRef | undefined;
  readonly budget: CallBudget;
  readonly command: boolean;
  readonly ceilingMs: number | undefined;
  readonly origin: LimitProvenance;
  readonly foregroundMs: number | undefined;
  readonly revision: number;
  readonly acquiredAt: bigint | undefined;
  readonly decidedAt: bigint | undefined;
  readonly deciding: Semaphore.Semaphore;
  readonly expiresAt: bigint | undefined;
  readonly wallExpiresAt: number | undefined;
  readonly armed: boolean;
  readonly exit: NativeExit | undefined;
  readonly stdout: SourceState;
  readonly stderr: SourceState;
  readonly decision: CallDecision | undefined;
  readonly persisted: boolean;
  readonly sequence: number;
  readonly scope: Scope.Scope;
  readonly timer: Fiber.Fiber<void> | undefined;
  readonly decided: Deferred.Deferred<CallDecision>;
};

export type CallEvent =
  | { readonly _tag: 'Exit'; readonly exit: NativeExit }
  | { readonly _tag: 'Source'; readonly stream: 'stdout' | 'stderr'; readonly offset: ByteOffset; readonly completed: boolean }
  | { readonly _tag: 'Cancel'; readonly cause: CancellationCause; readonly trigger: string }
  | { readonly _tag: 'Deadline' };

export type Decided = {
  readonly decision: CallDecision;
  readonly made: boolean;
  readonly persisted: boolean;
};

export type DeadlineState = {
  readonly revision: number;
  readonly executionMs: number | undefined;
  readonly ceilingMs: number | undefined;
  readonly origin: LimitProvenance;
  readonly foregroundMs: number | undefined;
  readonly armed: boolean;
  readonly elapsedMs: number | undefined;
  readonly wallExpiresAt: number | undefined;
};

export type Revision =
  | { readonly _tag: 'Revised'; readonly deadline: DeadlineState }
  | { readonly _tag: 'Stale'; readonly deadline: DeadlineState }
  | { readonly _tag: 'Refused'; readonly reason: RevisionRefusal; readonly detail: string }
  | { readonly _tag: 'Decided'; readonly decision: CallDecision }
  | { readonly _tag: 'Standing'; readonly standing: CommandRevisionRecord }
  | { readonly _tag: 'Unrecorded'; readonly reason: string };

export type CallAdmission = {
  readonly ceilingMs?: number;
  readonly revision?: number;
  readonly origin: LimitProvenance;
  readonly foregroundMs?: number;
};

export type CallLifetimes = {
  readonly open: (
    operation: HostRequestRef,
    execution: ExecutionRef | undefined,
    budget: CallBudget,
    admitted?: CallAdmission,
    resumed?: CallTiming,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly arm: (operation: HostRequestRef) => Effect.Effect<number | undefined, CallMissing | CallNotRecorded>;
  readonly deadline: (operation: HostRequestRef) => Effect.Effect<DeadlineState, CallMissing>;
  readonly revise: (
    operation: HostRequestRef,
    request: CommandRevisionRequest,
    origin?: LimitProvenance,
  ) => Effect.Effect<Revision, CallMissing>;
  readonly settle: (operation: HostRequestRef, event: CallEvent) => Effect.Effect<Decided | undefined, CallMissing>;
  readonly decision: (operation: HostRequestRef) => Effect.Effect<CallDecision | undefined, CallMissing>;
  readonly awaitDecision: (operation: HostRequestRef) => Effect.Effect<CallDecision, CallMissing>;
  readonly result: (
    operation: HostRequestRef,
    cleanup: Cleanup,
    retention: CallRetention,
    cost: ProcessCost,
  ) => Effect.Effect<CallDecisionAnswer, CallMissing>;
  readonly persist: (operation: HostRequestRef, retention: CallRetention | undefined) => Effect.Effect<CallRecord, CallMissing>;
};

export const makeCallLifetimes = Effect.gen(function* () {
  const callsRef = yield* Ref.make<ReadonlyMap<string, CallState>>(new Map());
  const store = yield* ExecutionStore;
  const open = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    execution: ExecutionRef | undefined,
    budget: CallBudget,
    admitted?: CallAdmission,
    resumed?: CallTiming,
  ): Effect.fn.Return<void, never, Scope.Scope> {
    const scope = yield* Effect.scope;
    const deciding = yield* Semaphore.make(1);
    const expiresAt = resumed?.expiresAt === undefined ? undefined : BigInt(resumed.expiresAt);
    yield* Effect.acquireRelease(
      Ref.update(callsRef, (calls) =>
        new Map(calls).set(operation.operation, {
          operation,
          execution,
          budget,
          command: admitted !== undefined,
          ceilingMs: resumed === undefined ? admitted?.ceilingMs : resumed.ceilingMs,
          origin: resumed?.origin ?? admitted?.origin ?? 'caller',
          foregroundMs: resumed === undefined ? admitted?.foregroundMs : resumed.foregroundMs,
          revision: resumed?.revision ?? admitted?.revision ?? 0,
          acquiredAt: resumed === undefined ? undefined : BigInt(resumed.acquiredAt),
          decidedAt: undefined,
          deciding,
          expiresAt,
          wallExpiresAt: resumed?.wallExpiresAt,
          armed: expiresAt !== undefined,
          exit: undefined,
          stdout: { completed: false, offset: byteOffset(0n) },
          stderr: { completed: false, offset: byteOffset(0n) },
          decision: undefined,
          persisted: false,
          sequence: 0,
          scope,
          timer: undefined,
          decided: Deferred.makeUnsafe<CallDecision>(),
        }),
      ),
      () => close(operation),
    );
    if (expiresAt === undefined) return;
    const timer = yield* Effect.forkIn(expire(operation), scope);
    yield* Ref.update(callsRef, (calls) => {
      const held = calls.get(operation.operation);
      return held === undefined ? calls : new Map(calls).set(operation.operation, { ...held, timer });
    });
  });

  const arm = Effect.fnUntraced(function* (operation: HostRequestRef): Effect.fn.Return<number | undefined, CallMissing | CallNotRecorded> {
    const now = yield* Clock.monotonicTimeNanos;
    const wall = yield* Clock.currentTimeMillis;
    const armed = yield* updateCall(operation, (held): readonly [number | undefined, CallState] => {
      const timeout = held.budget.timeoutMs;
      if (held.acquiredAt !== undefined) return [held.wallExpiresAt, held];
      if (timeout === undefined) return [undefined, { ...held, acquiredAt: now }];
      const expiresAt = now + BigInt(timeout) * 1_000_000n;
      return [wall + timeout, { ...held, armed: true, acquiredAt: now, expiresAt, wallExpiresAt: wall + timeout }];
    });
    yield* recordCall(operation, undefined);
    if (armed === undefined) return undefined;
    yield* schedule(operation);
    return armed;
  });

  const deadline = Effect.fnUntraced(function* (operation: HostRequestRef): Effect.fn.Return<DeadlineState, CallMissing> {
    const held = yield* read(operation);
    return deadlineOf(held, yield* Clock.monotonicTimeNanos);
  });

  function revise(
    operation: HostRequestRef,
    request: CommandRevisionRequest,
    origin: LimitProvenance = 'caller',
  ): Effect.Effect<Revision, CallMissing> {
    const { expected, change, actor, cause, exception } = request;
    return Effect.flatMap(read(operation), (call) =>
      call.deciding.withPermits(1)(
        Effect.gen(function* () {
          yield* decided(operation, { _tag: 'Deadline' });
          const now = yield* Clock.monotonicTimeNanos;
          const wall = yield* Clock.currentTimeMillis;
          const held = yield* read(operation);
          if (held.decision !== undefined) return { _tag: 'Decided', decision: held.decision } as const;
          if (held.execution === undefined || !held.command) {
            return {
              _tag: 'Refused',
              reason: 'not-a-command',
              detail: 'this call was opened with no admitted command intent, so it is not command work',
            } as const;
          }
          if (held.revision !== expected) return { _tag: 'Stale', deadline: deadlineOf(held, now) } as const;
          const elapsedMs = held.acquiredAt === undefined ? undefined : Number((now - held.acquiredAt) / 1_000_000n);
          const ceilingMs = exception?.ceilingMs ?? held.ceilingMs;
          const released = request.wait === 'background';
          const leftOrigin = released ? held.origin : origin;
          const foregroundMs = released ? undefined : held.foregroundMs;
          const asked = revisedTotal(change, { ceilingMs, elapsedMs, foregroundMs });
          if (asked._tag === 'Refused') return asked;
          const revision = held.revision + 1;
          const execution = held.execution;
          const expiresAt = held.acquiredAt === undefined ? undefined : held.acquiredAt + BigInt(asked.executionMs) * 1_000_000n;
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const apply = Effect.gen(function* () {
                yield* updateCall(operation, (standing): readonly [void, CallState] => [
                  undefined,
                  {
                    ...standing,
                    revision,
                    ceilingMs,
                    origin: leftOrigin,
                    foregroundMs,
                    budget: { ...standing.budget, timeoutMs: asked.executionMs },
                    armed: expiresAt !== undefined,
                    expiresAt,
                    wallExpiresAt: expiresAt === undefined ? undefined : wall + Math.max(0, asked.executionMs - (elapsedMs ?? 0)),
                  },
                ]);
                yield* schedule(operation);
                return yield* recordCall(operation, undefined).pipe(
                  Effect.matchEffect({
                    onFailure: (failure) =>
                      Effect.succeed<Revision>({
                        _tag: 'Unrecorded',
                        reason: failure._tag === 'CallMissing' ? 'CallMissing' : failure.cause,
                      }),
                    onSuccess: () =>
                      Effect.map(read(operation), (standing): Revision => ({ _tag: 'Revised', deadline: deadlineOf(standing, now) })),
                  }),
                );
              });
              const resolve = store.resolveRevision(request.operation, 'applied').pipe(
                Effect.matchEffect({
                  onFailure: (failure) => Effect.succeed<Revision>({ _tag: 'Unrecorded', reason: failure._tag }),
                  onSuccess: () => apply,
                }),
              );
              return yield* store
                .recordRevision({
                  execution,
                  operation: request.operation,
                  fingerprint: revisionIdentity(request),
                  revision,
                  executionMs: asked.executionMs,
                  ceilingMs,
                  origin: leftOrigin,
                  foregroundMs,
                  actor,
                  cause,
                  exception: exception === undefined ? undefined : { actor: exception.actor, cause: exception.cause },
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (failure) =>
                      Effect.succeed<Revision>(
                        failure._tag === 'OperationConflict'
                          ? { _tag: 'Refused', reason: 'conflict', detail: 'this key is taken by a different act' }
                          : { _tag: 'Unrecorded', reason: failure._tag },
                      ),
                    onSuccess: (written) =>
                      written._tag === 'Taken' ? Effect.succeed<Revision>({ _tag: 'Standing', standing: written.standing }) : resolve,
                  }),
                );
            }),
          );
        }),
      ),
    );
  }

  const expire = Effect.fnUntraced(
    function* (operation: HostRequestRef) {
      for (;;) {
        const standing = yield* read(operation);
        if (standing.expiresAt === undefined) return;
        const now = yield* Clock.monotonicTimeNanos;
        if (now >= standing.expiresAt) return yield* Effect.asVoid(settle(operation, { _tag: 'Deadline' }));
        yield* Effect.sleep(Duration.nanos(standing.expiresAt - now));
      }
    },
    Effect.catchTag('CallMissing', () => Effect.void),
  );

  const schedule = Effect.fnUntraced(function* (operation: HostRequestRef): Effect.fn.Return<void, CallMissing> {
    const standing = yield* read(operation);
    if (standing.expiresAt === undefined) return;
    const timer = yield* Effect.forkIn(expire(operation), standing.scope);
    const previous = yield* updateCall(operation, (held): readonly [Fiber.Fiber<void> | undefined, CallState] => [
      held.timer,
      { ...held, timer },
    ]);
    if (previous !== undefined) yield* Fiber.interrupt(previous);
  });

  function settle(operation: HostRequestRef, event: CallEvent): Effect.Effect<Decided | undefined, CallMissing> {
    return Effect.flatMap(read(operation), (call) => call.deciding.withPermits(1)(decided(operation, event)));
  }

  const decided = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    event: CallEvent,
  ): Effect.fn.Return<Decided | undefined, CallMissing> {
    const now = yield* Clock.monotonicTimeNanos;
    const chosen = yield* updateCall(operation, (held): readonly [Chosen, CallState] => {
      const recorded = record(held, event);
      if (recorded.decision !== undefined) {
        return [{ _tag: 'Standing', decided: { decision: recorded.decision, made: false, persisted: recorded.persisted } }, recorded];
      }
      const decision = decide(recorded, event, now);
      if (decision === undefined) return [{ _tag: 'Open' }, recorded];
      return [
        { _tag: 'Made', decision },
        { ...recorded, decision, decidedAt: now, sequence: recorded.sequence + 1 },
      ];
    });
    if (chosen._tag === 'Open') return undefined;
    if (chosen._tag === 'Standing') return chosen.decided;
    const made = chosen.decision;
    const written = yield* store.decide(made).pipe(
      Effect.match({
        onFailure: (): Decided => ({ decision: made, persisted: false, made: true }),
        onSuccess: (saved): Decided => ({ decision: saved.decision, persisted: true, made: saved._tag === 'Recorded' }),
      }),
    );
    const waiting = yield* updateCall(operation, (held) => [
      held.decided,
      { ...held, decision: written.decision, persisted: written.persisted },
    ]);
    yield* Deferred.succeed(waiting, written.decision);
    return written;
  });

  function decision(operation: HostRequestRef): Effect.Effect<CallDecision | undefined, CallMissing> {
    return Effect.map(read(operation), (held) => held.decision);
  }

  function awaitDecision(operation: HostRequestRef): Effect.Effect<CallDecision, CallMissing> {
    return Effect.flatMap(read(operation), (held) => Deferred.await(held.decided));
  }

  function result(
    operation: HostRequestRef,
    cleanup: Cleanup,
    retention: CallRetention,
    cost: ProcessCost,
  ): Effect.Effect<CallDecisionAnswer, CallMissing> {
    return Effect.map(read(operation), (held): CallDecisionAnswer => {
      const sources: SourceCompletion = { stdout: held.stdout, stderr: held.stderr };
      if (held.decision === undefined) {
        if (held.exit !== undefined && held.execution !== undefined) {
          return {
            _tag: 'Undecided',
            operation: held.operation,
            execution: held.execution,
            nativeExit: held.exit,
            sources,
            cleanup,
            retention,
            cost,
          };
        }
        return {
          _tag: 'Unavailable',
          operation: held.operation,
          execution: held.execution,
          reason: 'the call has not been decided',
        };
      }
      return {
        _tag: 'Decided',
        decision: held.decision,
        nativeExit: held.exit,
        sources,
        cleanup,
        retention,
        cost,
      };
    });
  }

  function persist(operation: HostRequestRef, retention: CallRetention | undefined): Effect.Effect<CallRecord, CallMissing> {
    return Effect.map(read(operation), (held) => ({
      operation: held.operation,
      execution: held.execution,
      budget: held.budget,
      started: held.acquiredAt === undefined ? undefined : ('native-acquired' as const),
      timing: held.acquiredAt === undefined ? undefined : timingOf(held, held.acquiredAt),
      sources: { stdout: held.stdout, stderr: held.stderr },
      retention: retention,
    }));
  }

  function recordCall(operation: HostRequestRef, retention: CallRetention | undefined): Effect.Effect<void, CallMissing | CallNotRecorded> {
    return Effect.flatMap(persist(operation, retention), (record) =>
      store
        .recordCall(record)
        .pipe(Effect.mapError((failure) => new CallNotRecorded({ operation: operation.operation, cause: failure._tag }))),
    );
  }

  function read(operation: HostRequestRef): Effect.Effect<CallState, CallMissing> {
    return Effect.flatMap(Ref.get(callsRef), (calls) => {
      const held = calls.get(operation.operation);
      return held === undefined ? Effect.fail(new CallMissing({ operation: operation.operation })) : Effect.succeed(held);
    });
  }

  function updateCall<A>(operation: HostRequestRef, f: (held: CallState) => readonly [A, CallState]): Effect.Effect<A, CallMissing> {
    return Effect.flatten(
      Ref.modify(callsRef, (calls): readonly [Effect.Effect<A, CallMissing>, ReadonlyMap<string, CallState>] => {
        const held = calls.get(operation.operation);
        if (held === undefined) return [Effect.fail(new CallMissing({ operation: operation.operation })), calls];
        const [answer, next] = f(held);
        return [Effect.succeed(answer), new Map(calls).set(operation.operation, next)];
      }),
    );
  }

  function close(operation: HostRequestRef): Effect.Effect<void> {
    return Ref.modify(callsRef, (calls) => {
      const held = calls.get(operation.operation);
      if (held === undefined) return [Effect.void, calls] as const;
      const next = new Map(calls);
      next.delete(operation.operation);
      return [Effect.void, next] as const;
    }).pipe(Effect.flatten);
  }

  return {
    open: open,
    arm: arm,
    deadline: deadline,
    revise: revise,
    settle: settle,
    decision: decision,
    awaitDecision: awaitDecision,
    result: result,
    persist: persist,
  } satisfies CallLifetimes;
});

type Chosen =
  | { readonly _tag: 'Open' }
  | { readonly _tag: 'Standing'; readonly decided: Decided }
  | { readonly _tag: 'Made'; readonly decision: CallDecision };

const timingOf = (held: CallState, acquiredAt: bigint): CallTiming => ({
  revision: held.revision,
  acquiredAt: acquiredAt.toString(),
  expiresAt: held.expiresAt?.toString(),
  wallExpiresAt: held.wallExpiresAt,
  ceilingMs: held.ceilingMs,
  origin: held.origin,
  foregroundMs: held.foregroundMs,
});

const deadlineOf = (held: CallState, now: bigint): DeadlineState => ({
  revision: held.revision,
  executionMs: held.budget.timeoutMs,
  ceilingMs: held.ceilingMs,
  origin: held.origin,
  foregroundMs: held.foregroundMs,
  armed: held.armed,
  elapsedMs: held.acquiredAt === undefined ? undefined : Number(((held.decidedAt ?? now) - held.acquiredAt) / 1_000_000n),
  wallExpiresAt: held.wallExpiresAt,
});

export const revisionIdentity = (request: CommandRevisionRequest): string =>
  JSON.stringify([
    'revise/2',
    request.execution.execution,
    request.expected,
    request.change._tag,
    request.change._tag === 'Total' ? request.change.executionMs : request.change.remainingMs,
    request.exception?.ceilingMs ?? null,
    request.wait ?? null,
  ]);

export type RevisionBounds = {
  readonly ceilingMs: number | undefined;
  readonly elapsedMs: number | undefined;
  readonly foregroundMs?: number;
};
export type RevisionTotal =
  | { readonly _tag: 'Total'; readonly executionMs: number }
  | { readonly _tag: 'Refused'; readonly reason: RevisionRefusal; readonly detail: string };

export const revisedTotal = (change: DeadlineChange, standing: RevisionBounds): RevisionTotal => {
  if (change._tag === 'Remaining' && standing.elapsedMs === undefined) {
    return {
      _tag: 'Refused',
      reason: 'not-armed',
      detail: 'no child has been acquired for this command yet, so there is no elapsed time to count from',
    };
  }
  const executionMs = change._tag === 'Total' ? change.executionMs : (standing.elapsedMs ?? 0) + change.remainingMs;
  if (standing.ceilingMs !== undefined && executionMs > standing.ceilingMs) {
    return {
      _tag: 'Refused',
      reason: 'above-ceiling',
      detail: `${executionMs}ms passes the ${standing.ceilingMs}ms ceiling this command was admitted under`,
    };
  }
  if (standing.foregroundMs !== undefined && executionMs > standing.foregroundMs) {
    return {
      _tag: 'Refused',
      reason: 'above-ceiling',
      detail: `${executionMs}ms passes the ${standing.foregroundMs}ms a command runs for while its caller waits on it; hand its call to the background first`,
    };
  }
  return { _tag: 'Total', executionMs };
};

const record = (held: CallState, event: CallEvent): CallState => {
  if (event._tag === 'Exit') return { ...held, exit: held.exit ?? event.exit };
  if (event._tag === 'Source') {
    const source: SourceState = { completed: event.completed, offset: event.offset };
    return event.stream === 'stdout' ? { ...held, stdout: source } : { ...held, stderr: source };
  }
  return held;
};

const decide = (held: CallState, event: CallEvent, now: bigint): CallDecision | undefined => {
  const sequence = held.sequence;
  const named = {
    operation: held.operation,
    execution: held.execution,
    sequence,
  };
  if (held.expiresAt !== undefined && now >= held.expiresAt) {
    return {
      _tag: 'Cancelled',
      ...named,
      cause: 'timeout',
      trigger: `deadline at ${held.wallExpiresAt} (revision ${held.revision})`,
    };
  }
  if (event._tag === 'Deadline') return undefined;
  if (held.exit !== undefined && held.stdout.completed && held.stderr.completed) {
    return held.execution === undefined ? undefined : { _tag: 'Completed', operation: held.operation, execution: held.execution, sequence };
  }
  if (event._tag === 'Cancel') return { _tag: 'Cancelled', ...named, cause: event.cause, trigger: event.trigger };
  return undefined;
};
