import { Context, Deferred, Effect, Exit, Ref, Scope } from 'effect';
import type { CallRetention, CancellationCause, StopStep } from '@runlith/executions/protocol/call';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';

import type { Cleanup, ExecutionRef, NativeExit, HostRequestRef, ProcessCost } from '@runlith/executions/protocol/execution';
import type {
  ConfirmedEnding,
  EndingReceipt,
  ResidualResource,
  StopAction,
  StopCoverage,
  StopReceipt,
  StreamEnding,
  UnverifiableResource,
} from '@runlith/executions/protocol/stop';
import type { NativeProcess } from '@runlith/executions/protocol/launch';
import type { SourceCompletion } from '@runlith/executions/protocol/call';
import type { ExecutionInput } from './ExecutionInput';
import { ExecutionStore } from './store/ExecutionStore';

type Store = Context.Service.Shape<typeof ExecutionStore>;

export type EndingReason = 'stopping' | 'ended';

export type StopTarget = {
  readonly relations: ReadonlyArray<NativeRelation>;
  readonly identity: () => Effect.Effect<NativeProcess>;
  readonly end: (action: StopAction, observed: NativeExit | undefined, reason: EndingReason) => Effect.Effect<NativeEnding>;
  readonly signal: (name: string) => Effect.Effect<NativeSignal>;
};

export type NativeSignal = {
  readonly delivered: boolean;
  readonly pid: number | undefined;
  readonly reason: 'exited' | 'closed' | 'unsupported' | 'stopping' | 'os' | undefined;
  readonly detail: string;
};

export type NativeEnding = {
  readonly exit: NativeExit | undefined;
  readonly measured: ReadonlyArray<NativeRelation>;
  readonly confirmed: ReadonlyArray<ConfirmedEnding>;
  readonly residual: ReadonlyArray<ResidualResource>;
  readonly unverifiable: ReadonlyArray<UnverifiableResource>;
  readonly abandonedOutput: boolean;
  readonly cost: ProcessCost;
  readonly steps: ReadonlyArray<StopStep>;
};

export type RecordFacts = {
  readonly streams: () => Effect.Effect<ReadonlyArray<StreamEnding>>;
  readonly sources: () => Effect.Effect<SourceCompletion>;
  readonly retention: () => Effect.Effect<CallRetention>;
  readonly observedExit: () => Effect.Effect<NativeExit | undefined>;
  readonly unrecorded: () => Effect.Effect<ReadonlyArray<UnverifiableResource>>;
};

type StopState = {
  readonly running: Deferred.Deferred<StopReceipt> | undefined;
  readonly measuring: Deferred.Deferred<EndingReceipt> | undefined;
  readonly settled: StopReceipt | undefined;
  readonly ended: EndingReceipt | undefined;
  readonly steps: ReadonlyArray<StopStep>;
  readonly unmeasurable: { readonly detail: string } | undefined;
  readonly cause: CancellationCause | undefined;
};

export type ExecutionStop = {
  readonly ref: ExecutionRef;
  readonly outcome: Effect.Effect<StopReceipt | undefined>;
  readonly measured: Effect.Effect<EndingReceipt | undefined>;
  readonly ending: Effect.Effect<EndingReceipt>;
  readonly unmeasurable: Effect.Effect<boolean>;
  readonly noteUnmeasurable: (unmeasured: UnverifiableResource, ending?: NativeEnding) => Effect.Effect<void>;
  readonly ended: () => Effect.Effect<EndingReceipt | undefined>;
  readonly stopping: Effect.Effect<boolean>;
  readonly stop: (operation: HostRequestRef, cause: CancellationCause, action: StopAction) => Effect.Effect<StopReceipt>;
};

export const makeExecutionStop = Effect.fnUntraced(function* ({
  input,
  target,
  facts,
  ref,
  ended: recorded,
}: {
  readonly input: ExecutionInput;
  readonly target: StopTarget;
  readonly facts: RecordFacts;
  readonly ref: ExecutionRef;
  readonly ended?: EndingReceipt;
}) {
  const state = yield* Ref.make<StopState>({
    running: undefined,
    measuring: undefined,
    settled: undefined,
    ended: recorded,
    steps: [],
    cause: undefined,
    unmeasurable: undefined,
  });
  const store = yield* ExecutionStore;
  const stateRef = state;
  const reachedValue = Deferred.makeUnsafe<EndingReceipt>();
  if (recorded !== undefined) yield* Deferred.succeed(reachedValue, recorded);
  function readOutcome(): Effect.Effect<StopReceipt | undefined> {
    return Effect.map(Ref.get(stateRef), (held) => held.settled);
  }

  function readMeasured(): Effect.Effect<EndingReceipt | undefined> {
    return Effect.map(Ref.get(stateRef), (held) => held.ended);
  }

  function readEnding(): Effect.Effect<EndingReceipt> {
    return Deferred.await(reachedValue);
  }

  function publish(receipt: EndingReceipt | undefined): Effect.Effect<void> {
    return receipt === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(reachedValue, receipt));
  }

  function readUnmeasurable(): Effect.Effect<boolean> {
    return Effect.map(Ref.get(stateRef), (held) => held.unmeasurable !== undefined);
  }

  const noteUnmeasurable = Effect.fnUntraced(function* (unmeasured: UnverifiableResource, ending?: NativeEnding): Effect.fn.Return<void> {
    for (;;) {
      const held = yield* Ref.get(stateRef);
      if (held.running !== undefined) yield* Deferred.await(held.running);
      else if (held.measuring !== undefined) yield* Deferred.await(held.measuring);
      else break;
    }
    const sources = yield* facts.sources();
    const retention = yield* facts.retention();
    const streams = yield* facts.streams();
    const unrecorded = yield* facts.unrecorded();
    const detail = `${unmeasured.detail}: ${unmeasured.reason}`;
    const recorded = yield* Ref.modify(stateRef, (held): readonly [EndingReceipt | undefined, StopState] => {
      if (held.ended !== undefined && (held.ended.cleanup === 'complete' || ending === undefined)) return [undefined, held] as const;
      const receipt: EndingReceipt = {
        execution: ref,
        coverage: ending?.measured ?? [],
        relation: ending === undefined ? 'unknown' : relationOf(ending),
        confirmed: ending?.confirmed ?? [],
        residual: [...(ending?.residual ?? []), ...(held.ended?.residual.filter((row) => row.kind === 'record') ?? [])],
        unverifiable: [
          unmeasured,
          ...(ending?.unverifiable ?? []),
          ...(held.ended?.unverifiable.filter((row) => row.kind === 'record') ?? []),
          ...unrecorded,
        ],
        streams,
        cleanup:
          (ending?.residual.length ?? 0) > 0 || held.ended?.residual.some((row) => row.kind === 'record') ? 'residual' : 'unverifiable',
        retention,
        abandonedOutput: (ending?.abandonedOutput ?? false) || (held.ended?.abandonedOutput ?? false),
        cost: { _tag: 'Unmeasured', reason: 'unknown', detail },
      };
      return [receipt, { ...held, ended: receipt, unmeasurable: { detail } }] as const;
    });
    if (recorded === undefined) return;
    const final = yield* Effect.result(
      store.recordFinal({
        execution: ref,
        sources,
        cleanup: recorded.cleanup,
        retention,
        confirmed: recorded.confirmed,
        residual: recorded.residual,
        unverifiable: recorded.unverifiable,
        streams,
        relation: recorded.relation,
        coverage: recorded.coverage,
        abandonedOutput: recorded.abandonedOutput,
      }),
    );
    if (final._tag === 'Success') return yield* publish(recorded);
    const receipt = withUnrecorded(recorded, [{ kind: 'record', detail: 'final facts', reason: String(final.failure._tag) }]);
    yield* Ref.update(stateRef, (held) => (held.ended === recorded ? { ...held, ended: receipt } : held));
    yield* publish(receipt);
  });

  function ended(): Effect.Effect<EndingReceipt | undefined> {
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const mine = Deferred.makeUnsafe<EndingReceipt>();
        const standing = yield* Ref.modify(stateRef, (held): readonly [Effect.Effect<EndingReceipt | undefined> | undefined, StopState] => {
          if (held.running !== undefined) return [Effect.andThen(Deferred.await(held.running), ended()), held];
          if (held.measuring !== undefined) return [Deferred.await(held.measuring), held];
          if (held.ended?.cleanup === 'complete' || held.unmeasurable !== undefined) return [Effect.succeed(held.ended), held];
          return [undefined, { ...held, measuring: mine }];
        });
        if (standing !== undefined) return yield* standing;
        const measured = yield* Effect.exit(measure('ended', 'ended: the execution finished on its own', 'signal', []));
        const outcome = Exit.map(measured, (taken) => taken.receipt);
        yield* Ref.update(stateRef, (held) => ({
          ...held,
          measuring: undefined,
          ended: Exit.isSuccess(measured) ? measured.value.receipt : held.ended,
          steps: Exit.isSuccess(measured) ? measured.value.steps : held.steps,
        }));
        yield* publish(Exit.isSuccess(outcome) ? outcome.value : undefined);
        yield* Deferred.done(mine, outcome);
        return yield* outcome;
      }),
    );
  }

  function readStopping(): Effect.Effect<boolean> {
    return Effect.map(Ref.get(stateRef), (held) => held.running !== undefined || held.settled !== undefined);
  }

  function stop(operation: HostRequestRef, cause: CancellationCause, action: StopAction): Effect.Effect<StopReceipt> {
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const joined = Deferred.makeUnsafe<StopReceipt>();
        const observed = yield* facts.observedExit();
        const taken = yield* Ref.modify(stateRef, (held): readonly [Taken, StopState] => {
          if (held.running !== undefined) return [{ _tag: 'Join', standing: held.running }, held];
          if (held.measuring !== undefined) return [{ _tag: 'Measuring', standing: held.measuring }, held];
          const answers =
            held.settled !== undefined &&
            !(action === 'destroy' && held.settled.requested === 'signal' && held.settled.cleanup !== 'complete') &&
            !(held.settled.cleanup !== 'complete' && observed !== undefined);
          if (answers) return [{ _tag: 'Answered', receipt: held.settled! }, held];
          if (held.ended !== undefined && held.ended.cleanup === 'complete') {
            const decided = held.cause ?? cause;
            return [
              {
                _tag: 'Answered',
                receipt: { ...held.ended, operation, requested: action, cause: decided, steps: held.steps },
              },
              { ...held, cause: decided },
            ];
          }
          return [
            { _tag: 'Run', decided: held.cause ?? cause },
            { ...held, running: joined, cause: held.cause ?? cause },
          ];
        });
        if (taken._tag === 'Measuring') {
          yield* Deferred.await(taken.standing);
          return yield* stop(operation, cause, action);
        }
        if (taken._tag === 'Join') {
          const unrecorded = yield* intended(operation, cause, action, true);
          const standing = yield* Deferred.await(taken.standing);
          return action === 'destroy' && standing.requested === 'signal' && standing.cleanup !== 'complete'
            ? yield* stop(operation, cause, action)
            : withUnrecorded(standing, unrecorded);
        }
        if (taken._tag === 'Answered') {
          return withUnrecorded(taken.receipt, yield* intended(operation, cause, action, true));
        }
        const outcome = yield* Effect.exit(run(operation, taken.decided, action));
        yield* Ref.update(stateRef, (held) => ({
          ...held,
          running: undefined,
          settled: Exit.isSuccess(outcome) ? outcome.value : held.settled,
          ended: Exit.isSuccess(outcome) ? outcome.value : held.ended,
          steps: Exit.isSuccess(outcome) ? outcome.value.steps : held.steps,
        }));
        yield* publish(Exit.isSuccess(outcome) ? outcome.value : undefined);
        yield* Deferred.done(joined, outcome);
        return yield* outcome;
      }),
    );
  }

  function intended(
    operation: HostRequestRef,
    cause: CancellationCause,
    action: StopAction,
    joined: boolean,
  ): Effect.Effect<ReadonlyArray<UnverifiableResource>> {
    return Effect.map(
      Effect.result(store.recordStop({ operation, execution: ref, cause, coverage: target.relations, requested: action, joined })),
      (intent) => (intent._tag === 'Failure' ? [{ kind: 'record', detail: 'stop intent', reason: String(intent.failure._tag) }] : []),
    );
  }

  const run = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    cause: CancellationCause,
    action: StopAction,
  ): Effect.fn.Return<StopReceipt> {
    const unrecorded = yield* intended(operation, cause, action, false);
    const measured = yield* measure('stopping', `stopping: ${cause}`, action, unrecorded);
    return { ...measured.receipt, operation, requested: action, cause, steps: measured.steps } satisfies StopReceipt;
  });

  const measure = Effect.fnUntraced(function* (
    reason: EndingReason,
    detail: string,
    action: StopAction,
    noted: ReadonlyArray<UnverifiableResource>,
  ): Effect.fn.Return<Measured> {
    const unverifiable: UnverifiableResource[] = [...noted, ...(yield* facts.unrecorded())];
    const residual: ResidualResource[] = [];

    const owed = yield* input.fence(reason, detail);
    if (owed.queued > 0) {
      residual.push({ kind: 'record', detail: `${owed.queued} accepted input bytes were never written to the child` });
    }
    if (owed.inFlight > 0) {
      unverifiable.push({
        kind: 'record',
        detail: `${owed.inFlight} accepted input bytes`,
        reason: 'a write of them was in flight when input was fenced; whether the child took them was not observed',
      });
    }
    if (owed.ended) {
      residual.push({ kind: 'record', detail: 'an admitted end of input was never written to the child' });
    }

    const identity = yield* target.identity();
    const observed = yield* facts.observedExit();
    const ending = yield* target.end(action, observed, reason);
    const unmeasuredProcess =
      ending.exit === undefined && ending.confirmed.length === 0 && ending.residual.length === 0 && identity.pid !== undefined;
    if (unmeasuredProcess) {
      unverifiable.push({
        kind: 'process',
        detail: `pid ${identity.pid}`,
        reason: 'no exit was observed, and whether the process ended could not be measured',
      });
    }

    const streams = yield* facts.streams();
    const sources = yield* facts.sources();
    const retention = yield* facts.retention();
    const cleanup = cleanupOf(ending, unmeasuredProcess);

    const final = yield* Effect.result(
      store.recordFinal({
        execution: ref,
        nativeExit: ending.exit,
        sources,
        cleanup,
        retention,
        confirmed: ending.confirmed,
        residual: [...residual, ...ending.residual],
        unverifiable: [...unverifiable, ...ending.unverifiable],
        streams,
        relation: relationOf(ending),
        coverage: [...ending.measured],
        abandonedOutput: ending.abandonedOutput,
      }),
    );
    if (final._tag === 'Failure') {
      unverifiable.push({ kind: 'record', detail: 'final facts', reason: String(final.failure._tag) });
    }

    const receipt = {
      execution: ref,
      nativeExit: ending.exit,
      coverage: ending.measured,
      relation: relationOf(ending),
      confirmed: ending.confirmed,
      residual: [...residual, ...ending.residual],
      unverifiable: [...unverifiable, ...ending.unverifiable],
      streams,
      cleanup,
      retention,
      abandonedOutput: ending.abandonedOutput,
      cost: ending.cost,
    } satisfies EndingReceipt;
    return { receipt, steps: ending.steps };
  });

  return {
    ref: ref,
    get outcome() {
      return readOutcome();
    },
    get measured() {
      return readMeasured();
    },
    get ending() {
      return readEnding();
    },
    get unmeasurable() {
      return readUnmeasurable();
    },
    noteUnmeasurable: noteUnmeasurable,
    ended: ended,
    get stopping() {
      return readStopping();
    },
    stop: stop,
  } satisfies ExecutionStop;
});

const withUnrecorded = <R extends { readonly unverifiable: ReadonlyArray<UnverifiableResource> }>(
  receipt: R,
  unrecorded: ReadonlyArray<UnverifiableResource>,
): R => (unrecorded.length === 0 ? receipt : { ...receipt, unverifiable: [...receipt.unverifiable, ...unrecorded] });

type Measured = { readonly receipt: EndingReceipt; readonly steps: ReadonlyArray<StopStep> };

type Taken =
  | { readonly _tag: 'Join'; readonly standing: Deferred.Deferred<StopReceipt> }
  | { readonly _tag: 'Measuring'; readonly standing: Deferred.Deferred<EndingReceipt> }
  | { readonly _tag: 'Answered'; readonly receipt: StopReceipt }
  | { readonly _tag: 'Run'; readonly decided: CancellationCause };

const cleanupOf = (ending: NativeEnding, unmeasuredProcess: boolean): Cleanup => {
  if (ending.residual.length > 0) return 'residual';
  if (ending.unverifiable.length > 0 || unmeasuredProcess) return 'unverifiable';
  return ending.exit === undefined || ending.confirmed.length === 0 ? 'pending' : 'complete';
};

export const relationOf = (ending: NativeEnding): StopCoverage => {
  if (ending.residual.length > 0) return 'partial';
  const proven = new Set<NativeRelation>(ending.confirmed.map((confirmed) => confirmed.relation));
  if (ending.measured.includes('ancestry')) proven.add('ancestry');
  if (proven.size === 0) return 'unknown';
  if (ending.measured.length > 1 && ending.measured.every((relation) => proven.has(relation))) return 'covered';
  return proven.has('leader') ? 'leader' : 'partial';
};

export const childlessEnding = {
  coverage: [],
  relation: 'covered',
  confirmed: [],
  residual: [],
  unverifiable: [],
} as const satisfies {
  readonly coverage: ReadonlyArray<NativeRelation>;
  readonly relation: StopCoverage;
  readonly confirmed: ReadonlyArray<ConfirmedEnding>;
  readonly residual: ReadonlyArray<ResidualResource>;
  readonly unverifiable: ReadonlyArray<UnverifiableResource>;
};
