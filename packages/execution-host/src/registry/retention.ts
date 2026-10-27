import { Data, Deferred, Effect, Ref, Context } from 'effect';
import { type CallRetention } from '@runlith/executions/protocol/call';
import { ExecutionId, type ExecutionRef, type ExecutionState, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type Stream as RecordStream, byteOffset } from '@runlith/executions/protocol/record';
import { type EndingReceipt } from '@runlith/executions/protocol/stop';
import type { SegmentRecord } from '../ExecutionRecord';
import { ExecutionUnknown, ExecutionUnrecorded } from '../executionFailures';
import { type Shelving } from '../RecordShelf';
import { type CapacityRefused, type ReservationMissing } from '../ExecutionCapacity';
import { type Live, type Reading, type RegistryState, live, moved, summaryOf, type HostClaim, commanding } from './state';
import { standingDeadline } from './revisions';
import { type CustodianRefused } from '../Custodian';
import { type CustodyLost } from '../store/errors';
import { type DisownReport, type Disowned } from '@runlith/executions/protocol/keep';

export class ExecutionRefused extends Data.TaggedError('ExecutionRefused')<{
  readonly execution: string;
}> {}

export type ForgetAnswer =
  | { readonly _tag: 'Forgotten'; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'ForgetRefused';
      readonly execution: ExecutionRef;
      readonly reason: 'running' | 'cleanup-unproven';
      readonly detail: string;
    }
  | { readonly _tag: 'ForgetUnresolved'; readonly execution: ExecutionRef; readonly reads: number };

export const retainedOf = (record: SegmentRecord): Effect.Effect<CallRetention> =>
  Effect.flatMap(record.availability, (availability) =>
    availability === 'unavailable'
      ? Effect.succeed('lost' as CallRetention)
      : availability === 'gapped'
        ? Effect.succeed('partial' as CallRetention)
        : Effect.map(record.sealed, (sealed) => (sealed === undefined ? 'retained' : sealed.written ? 'retained' : 'partial')),
  );

export const leased = <A, E>(
  registry: RegistryState,
  found: Live,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E | ExecutionRefused | CapacityRefused | ReservationMissing> => {
  const { capacity, reclaim } = registry;
  return Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(
      Effect.flatten(
        Ref.modify(found.reading, (reading): readonly [Effect.Effect<void, ExecutionRefused>, Reading] =>
          reading.fenced
            ? [Effect.fail(new ExecutionRefused({ execution: found.ref.execution })), reading]
            : [Effect.void, { ...reading, reads: reading.reads + 1 }],
        ),
      ),
      () =>
        Effect.flatMap(capacity.reserveRead(found.ref.execution), () =>
          Effect.andThen(
            reclaim.touch(found.ref.execution),
            restore(work).pipe(Effect.ensuring(Effect.orDie(capacity.releaseRead(found.ref.execution)))),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.flatten(
              Ref.modify(found.reading, (reading) => {
                const reads = Math.max(0, reading.reads - 1);
                return reads === 0 && reading.settled !== undefined
                  ? ([Effect.asVoid(Deferred.succeed(reading.settled, undefined)), { ...reading, reads, settled: undefined }] as const)
                  : ([reads === 0 ? releaseSoon(registry, found) : Effect.void, { ...reading, reads }] as const);
              }),
            ),
          ),
        ),
    ),
  );
};

const retireOf = Effect.fn('ExecutionRetirement.retire')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  execution: ExecutionId,
) {
  const { store, held, entered, shelf } = registry;
  for (let attempt = 0; ; attempt += 1) {
    const found = held.get(execution);
    if (found === undefined && !shelf.has(execution)) {
      const taken = yield* Effect.result(store.operationOf(operation));
      const entry = taken._tag === 'Success' ? taken.success : undefined;
      return entry !== undefined && entry.fingerprint === `retire:${execution}`
        ? ({
            _tag: 'Forgotten',
            execution: { installation: entered.installation, execution, incarnation: entered.incarnation },
          } satisfies ForgetAnswer)
        : yield* new ExecutionUnknown({ execution });
    }
    const forgotten = yield* forgetOf(registry, execution);
    if (forgotten._tag !== 'ForgetUnresolved') {
      if (forgotten._tag === 'Forgotten') {
        yield* Effect.ignore(
          store.settle({ operation, kind: 'receipt', fingerprint: `retire:${execution}`, receipt: { _tag: 'Accepted' } }),
        );
      }
      return forgotten;
    }
    if (found === undefined || attempt >= 3) return forgotten;
    yield* Effect.flatten(
      Ref.modify(found.reading, (reading) => {
        if (reading.reads === 0) return [Effect.void, reading] as const;
        const settled = reading.settled ?? Deferred.makeUnsafe<void>();
        return [Deferred.await(settled), { ...reading, settled }] as const;
      }),
    );
  }
});

export const sourcesOf = Effect.fnUntraced(function* (record: SegmentRecord) {
  const answer = Effect.fnUntraced(function* (stream: RecordStream) {
    const positions = yield* Effect.result(record.positions(stream));
    if (positions._tag === 'Failure') {
      yield* Effect.logWarning(
        `the ${stream} frontier of a record could not be read; it is taken as incomplete at zero`,
        positions.failure,
      );
      return { completed: false, offset: byteOffset(0n) };
    }
    return { completed: positions.success.ending === 'eof', offset: positions.success.durableThrough };
  });
  return record.transport === 'pty'
    ? { stdout: yield* answer('pty'), stderr: yield* answer('pty') }
    : { stdout: yield* answer('stdout'), stderr: yield* answer('stderr') };
});

export const releaseSoon = Effect.fnUntraced(function* (registry: RegistryState, found: Live) {
  const { registryScope } = registry;
  const state = yield* Ref.get(found.state);
  if (state.phase !== 'ended' || state.transport === 'pty' || state.lifetime !== 'command') return;
  const reading = yield* Ref.get(found.reading);
  if (reading.fenced || reading.reads > 0 || reading.readers > 0) return;
  yield* Effect.forkIn(Effect.asVoid(releaseOf(registry, found.ref.execution)), registryScope);
});

const releaseOf = Effect.fn('ExecutionRetirement.release')(function* (registry: RegistryState, execution: ExecutionId) {
  const { held, shelf } = registry;
  const found = held.get(execution);
  if (found === undefined) return false;
  const state = yield* Ref.get(found.state);
  if (state.transport === 'pty' || state.lifetime !== 'command' || state.phase !== 'ended') return false;
  if (!(yield* Deferred.isDone(found.worked))) return false;
  const receipt = yield* found.execution.stop.measured;
  const unmeasurable = yield* found.execution.stop.unmeasurable;
  if (receipt === undefined || (receipt.cleanup !== 'complete' && !(unmeasurable && receipt.cleanup === 'unverifiable'))) {
    return false;
  }
  const fence = Ref.modify(found.reading, (reading): readonly [boolean, Reading] =>
    reading.fenced || reading.reads > 0 || reading.readers > 0 ? [false, reading] : [true, { ...reading, fenced: true }],
  );
  return yield* shelf.release(execution, fence, sealOf(registry, found, receipt), handedOver(registry, found));
});

const handedOver = (registry: RegistryState, found: Live): Effect.Effect<void> =>
  Effect.andThen(
    found.close,
    Effect.andThen(
      Effect.sync(() => registry.held.release(found.ref)),
      moved(registry, found),
    ),
  );

const sealOf = Effect.fn('ExecutionRetirement.seal')(function* (registry: RegistryState, found: Live, receipt: EndingReceipt) {
  const { store, pacing } = registry;
  const execution = found.ref.execution;
  const summary = yield* summaryOf(registry, found);
  const sources = yield* sourcesOf(found.execution.record);
  const processes = yield* found.execution.processes;
  const pace = pacing.paceOf(execution);
  const row = yield* Effect.result(store.executionOf(execution));
  if (row._tag === 'Failure') {
    yield* Effect.logWarning(`the admission of ${execution} could not be read; its record shelves without owner or deadline`, row.failure);
  }
  const admission = row._tag === 'Success' ? row.success.command : undefined;
  const standing =
    admission === undefined ? undefined : yield* Effect.result(standingDeadline(registry, found.ref, admission, found.operation));
  if (standing?._tag === 'Failure') {
    yield* Effect.logWarning(`the deadline of ${execution} could not be read; its shelved record reads it again`, standing.failure);
  }
  const sealed = yield* found.execution.record.seal();
  const state = yield* Ref.get(found.state);
  const process = yield* Ref.get(found.process);
  return {
    ref: found.ref,
    directory: found.execution.record.directory,
    seal: sealed.seal,
    summary,
    state,
    process,
    receipt,
    deadline: standing?._tag === 'Success' ? standing.success : undefined,
    processes,
    pace,
    sources,
    owner: admission?.origin.owner,
    scope: admission?.origin.scope,
  } satisfies Shelving;
});

function forgetOf(registry: RegistryState, execution: ExecutionId): Effect.Effect<ForgetAnswer, ExecutionUnknown | ExecutionUnrecorded> {
  const { held, shelf } = registry;
  return Effect.suspend(() => {
    const gate = shelf.gate(execution);
    if (gate !== undefined) return Effect.andThen(Deferred.await(gate), forgetOf(registry, execution));
    if (held.has(execution) || !shelf.has(execution)) return forgetLive(registry, execution);
    return Effect.flatMap(shelf.drop(execution), (ref) =>
      ref === undefined ? forgetOf(registry, execution) : Effect.succeed({ _tag: 'Forgotten', execution: ref } satisfies ForgetAnswer),
    );
  });
}

function forgetLive(registry: RegistryState, execution: ExecutionId): Effect.Effect<ForgetAnswer, ExecutionUnknown | ExecutionUnrecorded> {
  const { store, fs, held, inventoryWoken, shelf } = registry;
  return Effect.flatMap(live(registry, execution), (found) =>
    Effect.gen(function* () {
      const receipt = yield* found.execution.stop.measured;
      const unmeasurable = yield* found.execution.stop.unmeasurable;
      if (receipt === undefined || (receipt.cleanup !== 'complete' && !(unmeasurable && receipt.cleanup === 'unverifiable'))) {
        const state = yield* Ref.get(found.state);
        return {
          _tag: 'ForgetRefused',
          execution: found.ref,
          ...(receipt === undefined && state.phase !== 'ended'
            ? { reason: 'running' as const, detail: `the execution stands at ${state.phase} and nothing has stopped it` }
            : {
                reason: 'cleanup-unproven' as const,
                detail:
                  receipt === undefined
                    ? 'nothing has measured what this execution left; its exit alone proves nothing'
                    : `the ending reported cleanup ${receipt.cleanup}`,
              }),
        } satisfies ForgetAnswer;
      }
      const standing = yield* Ref.modify(found.reading, (reading): readonly [number | 'releasing', Reading] =>
        shelf.gate(execution) !== undefined ? ['releasing', reading] : [reading.reads, { ...reading, fenced: true }],
      );
      if (standing === 'releasing') return yield* forgetOf(registry, execution);
      if (standing > 0) {
        return { _tag: 'ForgetUnresolved', execution: found.ref, reads: standing } satisfies ForgetAnswer;
      }
      const sources = yield* sourcesOf(found.execution.record);
      yield* found.close;
      const intended = yield* Effect.result(store.beginRemoval(found.ref, undefined));
      if (intended._tag === 'Failure') {
        return yield* new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${intended.failure._tag}` });
      }
      const unavailable = yield* Ref.updateAndGet(found.state, (state): ExecutionState => ({ ...state, record: 'unavailable' }));
      const unrecorded = yield* Effect.result(store.recordState(unavailable, yield* Ref.get(found.process)));
      if (unrecorded._tag === 'Failure') {
        return yield* new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${unrecorded.failure._tag}` });
      }
      const facts = yield* Effect.result(store.recordFinal({ ...receipt, sources, retention: 'lost' }));
      if (facts._tag === 'Failure') {
        return yield* new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${facts.failure._tag}` });
      }
      yield* fs.remove(found.execution.record.directory, { recursive: true, force: true }).pipe(Effect.orDie);
      const ended = yield* Effect.result(store.endRemoval(execution));
      if (ended._tag === 'Failure') {
        yield* Effect.logWarning(`the finished removal of ${execution} stays listed; the next logic finishes it again`, ended.failure);
      }
      held.release(found.ref);
      yield* moved(registry, found);
      yield* inventoryWoken;
      return { _tag: 'Forgotten', execution: found.ref } satisfies ForgetAnswer;
    }),
  );
}

export class ExecutionRetirement extends Context.Service<
  ExecutionRetirement,
  {
    readonly forget: (execution: ExecutionId) => Effect.Effect<ForgetAnswer, ExecutionUnknown | ExecutionUnrecorded>;
    readonly retire: (
      claim: HostClaim,
      operation: HostRequestRef,
      execution: ExecutionId,
    ) => Effect.Effect<ForgetAnswer, ExecutionUnknown | ExecutionUnrecorded | CustodianRefused | CustodyLost>;
    readonly reclaim: () => Effect.Effect<void>;
  }
>()('@runlith/execution-host/ExecutionRetirement') {}

export class HostDisown extends Context.Service<
  HostDisown,
  {
    readonly disown: (claim: HostClaim, disowned: Disowned) => Effect.Effect<DisownReport, CustodianRefused | CustodyLost>;
  }
>()('@runlith/execution-host/HostDisown') {}

export const executionRetirementOf = (registry: RegistryState) =>
  ExecutionRetirement.of({
    forget: (execution) => forgetOf(registry, execution),
    retire: (claim, operation, execution) =>
      Effect.flatMap(commanding(registry, claim, 'end'), () => retireOf(registry, operation, execution)),
    reclaim: () => registry.reclaim.wake(),
  });

export const hostDisownOf = (registry: RegistryState) =>
  HostDisown.of({
    disown: (claim, disowned) => Effect.andThen(commanding(registry, claim, 'start'), registry.shelf.disown(disowned)),
  });
