import { Effect, Path } from 'effect';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import { RecordNameInvalid, recordFolder } from '@runlith/executions/recordFormat';
import { ExecutionStore } from './store/ExecutionStore';
import type { IncarnationRecord, RecordRemoval, RetainedExecution } from './store/records';
import type { RecordMeasurement } from './RecordMeasure';

export const INHERITED_PAGE = 128;

export type Inherited = {
  readonly ref: ExecutionRef;
  readonly evidence: RetainedExecution;
  readonly bytes: number;
};

type Unfinished = RecordRemoval & { readonly inherited: boolean };

export type InheritedInput = {
  readonly current: IncarnationRecord;
  readonly records: string;
  readonly measure: (directory: string) => Effect.Effect<RecordMeasurement>;
  readonly kept: (execution: ExecutionId) => boolean;
  readonly finishRemoval: (ref: ExecutionRef) => Effect.Effect<boolean>;
};

export const makeInheritedRecords = Effect.fnUntraced(function* (input: InheritedInput) {
  const { current, records, measure, kept, finishRemoval } = input;
  const store = yield* ExecutionStore;
  const path = yield* Path.Path;
  const standing = yield* store.shelfLedger(current.incarnation);
  let bytes = standing.through === undefined ? 0 : standing.bytes;
  let after: number | undefined;
  let page: ExecutionId[] = [];
  let done = standing.through === undefined;
  const retry: ExecutionId[] = [];
  const unfinished: Unfinished[] = (yield* store.unfinishedRemovals(current.incarnation)).map((removal) => ({
    ...removal,
    inherited: true,
  }));
  const refOf = (execution: ExecutionId): ExecutionRef => ({
    installation: current.installation,
    execution,
    incarnation: current.incarnation,
  });

  const next = Effect.fnUntraced(function* (): Effect.fn.Return<Inherited | undefined> {
    for (;;) {
      if (page.length === 0) {
        if (done || standing.through === undefined) return undefined;
        const listed = yield* Effect.result(store.shelvedRecords(current.incarnation, after, standing.through, INHERITED_PAGE));
        if (listed._tag === 'Failure') {
          yield* Effect.logWarning(
            `the records an earlier logic shelved were not listed: ${listed.failure._tag}; the next decision lists them again`,
          );
          return undefined;
        }
        page = [...listed.success.executions];
        after = listed.success.next;
        done = listed.success.next === undefined;
        continue;
      }
      const execution = page.shift()!;
      if (kept(execution)) continue;
      const folder = recordFolder(execution);
      if (folder instanceof RecordNameInvalid) continue;
      const ref = refOf(execution);
      const evidence = yield* Effect.result(store.evidenceOf(ref));
      if (evidence._tag === 'Failure') {
        retry.push(execution);
        yield* Effect.logWarning(
          `the record of ${execution} an earlier logic shelved was not read; the next decision reads it again`,
          evidence.failure,
        );
        continue;
      }
      const { state } = evidence.success.record;
      if (state.phase !== 'ended' || state.record !== 'available') continue;
      const measurement = yield* measure(path.join(records, folder));
      if (measurement._tag === 'Unmeasured' && measurement.failure.reason._tag === 'NotFound') {
        return { ref, evidence: evidence.success, bytes: 0 };
      }
      if (measurement._tag === 'Unmeasured') {
        retry.push(execution);
        yield* Effect.logWarning(
          `the record of ${execution} an earlier logic shelved could not be measured; the next decision measures it again`,
          measurement.failure,
        );
        continue;
      }
      return { ref, evidence: evidence.success, bytes: measurement.bytes };
    }
  });

  const evict = Effect.fn('Host.evictInherited')(function* (inherited: Inherited): Effect.fn.Return<boolean> {
    const { ref, evidence } = inherited;
    yield* Effect.annotateCurrentSpan({ executionId: ref.execution, bytes: inherited.bytes });
    const recorded = yield* Effect.result(
      Effect.gen(function* () {
        yield* store.noteRecordPending(ref.incarnation);
        yield* store.beginRemoval(ref, inherited.bytes);
        yield* store.recordState({ ...evidence.record.state, record: 'unavailable' }, evidence.record.native);
        if (evidence.final !== undefined) yield* store.recordFinal({ ...evidence.final, retention: 'lost' });
      }),
    );
    if (recorded._tag === 'Failure') {
      retry.push(ref.execution);
      yield* Effect.logWarning(`the retirement of ${ref.execution} stays unrecorded; the next decision retires it again`, recorded.failure);
      return false;
    }
    bytes = Math.max(0, bytes - inherited.bytes);
    if (!(yield* finishRemoval(ref))) unfinished.push({ execution: ref.execution, ledgered: inherited.bytes, inherited: false });
    return true;
  });

  const markedLost = Effect.fnUntraced(function* (ref: ExecutionRef) {
    const evidence = yield* store.evidenceOf(ref);
    if (evidence.record.state.record === 'unavailable') return;
    yield* store.recordState({ ...evidence.record.state, record: 'unavailable' }, evidence.record.native);
    if (evidence.final !== undefined) yield* store.recordFinal({ ...evidence.final, retention: 'lost' });
  });

  const finishUnfinished = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const left: Unfinished[] = [];
    for (const removal of unfinished.splice(0)) {
      const ref = refOf(removal.execution);
      if (kept(removal.execution)) {
        left.push(removal);
        continue;
      }
      if (removal.inherited) {
        const marked = yield* Effect.result(markedLost(ref));
        if (marked._tag === 'Failure' && marked.failure._tag !== 'StoredExecutionMissing') {
          yield* Effect.logWarning(
            `the unfinished removal of ${removal.execution} was not marked lost; the next decision marks it`,
            marked.failure,
          );
          left.push(removal);
          continue;
        }
      }
      if (!(yield* finishRemoval(ref))) {
        left.push(removal);
        continue;
      }
      if (removal.inherited) bytes = Math.max(0, bytes - (removal.ledgered ?? 0));
    }
    unfinished.push(...left);
  });

  return {
    bytes: (): number => bytes,
    next,
    evict,
    finishUnfinished,
    retryRemoval: (execution: ExecutionId, ledgered: number): void => {
      unfinished.push({ execution, ledgered, inherited: false });
    },
    resume: (): void => {
      page.unshift(...retry.splice(0));
    },
    settle: (): number => {
      if (!done || page.length > 0 || retry.length > 0) return 0;
      const residue = bytes;
      bytes = 0;
      return residue;
    },
  };
});
