import { Deferred, Effect, Ref, Context } from 'effect';
import { ExecutionId, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type CallAnswer, type OperationAnswer } from '@runlith/executions/protocol/runtime';
import { StoreLost } from '../store/errors';
import { type RegistryState } from './state';
import { retainedOf } from './retention';
import type { StopPrevention } from '@runlith/executions/protocol/stop';
import { commanding, type HostClaim } from './state';

const executionOf = (decision: { readonly execution?: ExecutionRef } | undefined): ExecutionId =>
  (decision?.execution?.execution ?? '') as ExecutionId;

const acceptedAnswer = Effect.fnUntraced(function* (registry: RegistryState, operation: HostRequestRef, execution: ExecutionId) {
  const { store } = registry;
  const read = yield* Effect.result(store.executionOf(execution));
  if (read._tag === 'Failure') {
    return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
  }
  return { _tag: 'Accepted', operation, execution: read.success.state.ref } satisfies OperationAnswer;
});

const stopKeyAnswer = Effect.fn('ExecutionRequest.stopKeyAnswer')(function* (registry: RegistryState, operation: HostRequestRef) {
  const { store, held } = registry;
  const intent = yield* Effect.result(store.stopIntentOf(operation));
  if (intent._tag === 'Failure' || intent.success === undefined) {
    if (intent._tag === 'Success') return yield* revisionKeyAnswer(registry, operation);
    return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
  }
  const asked = intent.success;
  const found = held.get(asked.execution.execution);
  if (found !== undefined) {
    const settled = yield* found.execution.stop.outcome;
    if (settled !== undefined) return { _tag: 'Accepted', operation, execution: found.ref } satisfies OperationAnswer;
    return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
  }
  const read = yield* Effect.result(store.executionOf(asked.execution.execution));
  if (read._tag === 'Failure') {
    return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
  }
  const record = read.success;
  const finals = yield* Effect.result(store.finalOf(asked.execution.execution));
  const final = finals._tag === 'Success' ? finals.success : undefined;
  const proven = final !== undefined && (final.cleanup === 'complete' || (final.nativeExit !== undefined && final.cleanup === 'residual'));
  if (proven) {
    return { _tag: 'Accepted', operation, execution: asked.execution } satisfies OperationAnswer;
  }
  return {
    _tag: 'Uncertain',
    effect: {
      _tag: 'StoreFailed',
      operation,
      execution: asked.execution,
      phase: record.state.phase,
      cleanup: 'unknown',
      reason: `stop for execution ${asked.execution.execution} stands undecided at ${record.state.phase}; the execution is gone and nothing vouches for what it left`,
    },
  } satisfies OperationAnswer;
});

const revisionKeyAnswer = (registry: RegistryState, operation: HostRequestRef): Effect.Effect<OperationAnswer> => {
  const { store } = registry;
  return Effect.map(Effect.result(store.revisionAt(operation)), (read) => {
    if (read._tag === 'Failure') return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
    const row = read.success;
    if (row === undefined) return { _tag: 'Unanswered', operation } satisfies OperationAnswer;
    return row.outcome === 'pending'
      ? ({ _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer)
      : ({ _tag: 'Accepted', operation, execution: row.execution } satisfies OperationAnswer);
  });
};

const forgottenCall = Effect.fn('ExecutionRequest.forgottenCall')(function* (registry: RegistryState, operation: HostRequestRef) {
  const { store } = registry;
  const written = yield* Effect.result(store.decisionOf(operation));
  if (written._tag === 'Failure') {
    return {
      _tag: 'Settled',
      result: { _tag: 'Unavailable', operation, reason: `the metadata file could not be read: ${written.failure._tag}` },
    } satisfies CallAnswer;
  }
  const decided = written.success;
  const record = yield* Effect.result(store.callOf(operation));
  if (record._tag === 'Failure') {
    return {
      _tag: 'Settled',
      result: {
        _tag: 'Unavailable',
        operation,
        execution: decided?.execution,
        lastKnown: decided,
        reason: `the call record could not be read: ${record.failure._tag}: ${'reason' in record.failure ? record.failure.reason : record.failure.message}`,
      },
    } satisfies CallAnswer;
  }
  const call = record.success;
  if (decided === undefined) {
    return {
      _tag: 'Settled',
      result: {
        _tag: 'Unavailable',
        operation,
        execution: call?.execution,
        reason: 'this host holds no call under that key and none was decided in the file',
      },
    } satisfies CallAnswer;
  }
  const execution = decided._tag === 'Completed' ? decided.execution : decided.execution;
  const final =
    execution === undefined
      ? undefined
      : yield* Effect.map(Effect.result(store.finalOf(execution.execution)), (facts) =>
          facts._tag === 'Success' ? facts.success : undefined,
        );
  const sources = call?.sources ?? final?.sources;
  const retention = final?.retention ?? call?.retention;
  if (sources === undefined || retention === undefined) {
    return {
      _tag: 'Settled',
      result: {
        _tag: 'Unavailable',
        operation,
        execution: execution,
        lastKnown: decided,
        reason:
          sources === undefined
            ? 'the decision was retained but the source frontiers it ended with were not'
            : 'the decision was retained but what became of its bytes was not',
      },
    } satisfies CallAnswer;
  }
  return {
    _tag: 'Settled',
    result: {
      _tag: 'Decided',
      decision: decided,
      nativeExit: final?.nativeExit,
      sources,
      cleanup: final?.cleanup ?? 'unverifiable',
      retention,
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'the final-facts row holds no accounting for this call' },
    },
  } satisfies CallAnswer;
});

const operationAnswer = Effect.fn('ExecutionRequest.operation')(function* (registry: RegistryState, operation: HostRequestRef) {
  const { store, held } = registry;
  const taken = yield* Effect.result(store.operationAnswerOf(operation));
  if (taken._tag === 'Failure') {
    if (taken.failure instanceof StoreLost) {
      const live = held
        .all()
        .find((found) => found.operation.operation === operation.operation && found.operation.installation === operation.installation);
      if (live !== undefined) {
        const state = yield* Ref.get(live.state);
        return {
          _tag: 'Uncertain',
          effect: {
            _tag: 'StoreFailed',
            operation,
            execution: live.ref,
            phase: state.phase,
            cleanup: taken.failure.cleanup,
            reason: taken.failure.reason,
          },
        } satisfies OperationAnswer;
      }
    }
    return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies OperationAnswer;
  }
  const entry = taken.success;
  if (entry === undefined) return yield* stopKeyAnswer(registry, operation);
  if (entry.kind === 'tombstone') return { _tag: 'Cancelled', operation } satisfies OperationAnswer;
  const receipt = entry.receipt;
  if (receipt._tag === 'Refused') return { _tag: 'Refused', operation, refusal: receipt.refusal } satisfies OperationAnswer;
  if (receipt._tag === 'Uncertain') return { _tag: 'Uncertain', effect: receipt.effect } satisfies OperationAnswer;
  if (entry.execution === undefined) return { _tag: 'Accepted', operation } satisfies OperationAnswer;
  return yield* acceptedAnswer(registry, operation, entry.execution);
});

const callResult = Effect.fn('ExecutionRequest.callResult')(function* (registry: RegistryState, operation: HostRequestRef) {
  const { calls, held } = registry;
  const decision = yield* Effect.result(calls.decision(operation));
  if (decision._tag === 'Failure') return yield* forgottenCall(registry, operation);
  if (decision.success === undefined) {
    return { _tag: 'Pending', operation } satisfies CallAnswer;
  }
  const found = held.get(executionOf(decision.success));
  if (found === undefined) return yield* forgottenCall(registry, operation);
  if (decision.success._tag === 'Completed') yield* Deferred.await(found.worked);
  const receipt = yield* found.execution.stop.measured;
  const retention = yield* retainedOf(found.execution.record);
  const result = yield* Effect.result(
    calls.result(
      operation,
      receipt?.cleanup ?? 'unverifiable',
      receipt?.retention ?? retention,
      receipt?.cost ?? { _tag: 'Unmeasured', reason: 'unknown', detail: 'this call has no measured ending' },
    ),
  );
  return result._tag === 'Success'
    ? ({ _tag: 'Settled', result: result.success } satisfies CallAnswer)
    : yield* forgottenCall(registry, operation);
});

const preventStop = Effect.fn('ExecutionRequest.preventStop')(function* (
  registry: RegistryState,
  claim: HostClaim,
  operation: HostRequestRef,
  execution: ExecutionRef,
): Effect.fn.Return<StopPrevention> {
  const allowed = yield* Effect.result(commanding(registry, claim, 'end'));
  if (allowed._tag === 'Failure') {
    return {
      _tag: 'Refused',
      operation,
      refusal: { _tag: 'Unauthorized', reason: `the stop key could not be fenced: ${allowed.failure._tag}` },
    };
  }
  const prevented = yield* Effect.result(
    registry.store.settle({
      operation,
      kind: 'tombstone',
      fingerprint: `prevent-stop:${execution.installation}:${execution.execution}:${execution.incarnation}`,
      receipt: { _tag: 'Accepted' },
    }),
  );
  if (prevented._tag === 'Success') return { _tag: 'Prevented', operation };
  if (prevented.failure._tag === 'OperationConflict') return { _tag: 'Taken', operation };
  return { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } };
});

export class ExecutionRequest extends Context.Service<
  ExecutionRequest,
  {
    readonly operation: (operation: HostRequestRef) => Effect.Effect<OperationAnswer>;
    readonly preventStop: (claim: HostClaim, operation: HostRequestRef, execution: ExecutionRef) => Effect.Effect<StopPrevention>;
    readonly callResult: (operation: HostRequestRef) => Effect.Effect<CallAnswer>;
  }
>()('@runlith/execution-host/ExecutionRequest') {}

export const executionRequestOf = (registry: RegistryState) =>
  ExecutionRequest.of({
    operation: (operation) => operationAnswer(registry, operation),
    preventStop: (claim, operation, execution) => preventStop(registry, claim, operation, execution),
    callResult: (operation) => callResult(registry, operation),
  });
