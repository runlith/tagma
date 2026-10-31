import { Clock, Deferred, Effect } from 'effect';
import type { ThreadRow, ThreadRunKind, ThreadRunProgress, ThreadRunRow } from '../../rows';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadEventInsert, ThreadEventRow } from '../../storage/eventLog';
import type { ThreadHold } from '../../transition/port';
import type { ThreadAtomicPatch } from '../../storage/aggregate';
import {
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  THREAD_RUN_RESUMING_STAGE,
  type ThreadRunCreate,
  type ThreadRunReapSelector,
  type ThreadRunSettlePatch,
  type ThreadRunStart,
  type ThreadRunStopPatch,
} from '../../storage/runs';
import type { ThreadStorageHarness } from '../storagePort';
import type { ThreadPortFailure } from '../../ThreadBorder';
export const OWNER = 'owner';
export const SCOPE = 'scope-a';
export const OTHER_SCOPE = 'scope-b';
export const INSTANCE = 'instance-1';
export const OTHER_INSTANCE = 'instance-2';
export const STARTING: ThreadRunProgress = { stage: 'starting', message: null };
export const AWAITING: ThreadRunProgress = { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: null };
export const REAPED: ThreadRunProgress = { stage: 'failed', message: 'Thread run was interrupted.' };
export function folding<TTx, E, TWrite extends TTx = TTx>(
  harness: ThreadStorageHarness<TTx, TWrite>,
  threadId: string,
  work: (at: ThreadHold<TWrite>) => Effect.Effect<ThreadAtomicPatch | null, E>,
): Effect.Effect<void, unknown> {
  return harness.transitions.writeAt(
    threadId,
    Effect.fnUntraced(function* (at) {
      const fold = yield* work(at);
      if (fold === null) return;
      const head = yield* harness.eventLog.headPosition(threadId, at.tx);
      yield* harness.transitions.writeFold(
        threadId,
        { fold, standing: at.version.head, head, at: new Date(yield* Clock.currentTimeMillis) },
        at.tx,
      );
    }),
  );
}
export function appendEvent<TTx, TWrite extends TTx = TTx>(
  harness: ThreadStorageHarness<TTx, TWrite>,
  event: ThreadEventInsert,
): Effect.Effect<ThreadEventRow, ThreadPortFailure> {
  return harness.aggregate.transaction((tx) => harness.eventLog.append(event, tx));
}
export const gate = Effect.fnUntraced(function* () {
  const reached = yield* Deferred.make<void>();
  const released = yield* Deferred.make<void>();
  return {
    reach: Deferred.succeed(reached, undefined),
    reached: Deferred.await(reached),
    release: Deferred.succeed(released, undefined),
    released: Deferred.await(released),
  };
});
export const started = Effect.fnUntraced(function* <E>(start: Effect.Effect<ThreadRunStart, E>): Effect.fn.Return<ThreadRunRow, E> {
  const answered = yield* start;
  if (answered._tag !== 'Started') return yield* Effect.die(`Run ${answered.run.id} was replayed where a new run was expected.`);
  return answered.run;
});
export function startInput(thread: ThreadRow, kind: ThreadRunKind = 'turn'): ThreadRunCreate {
  return {
    kind,
    startFrom: {
      id: thread.id,
      ownerId: thread.ownerId,
      account: thread.account,
      provider: thread.provider,
      model: thread.model,
      reasoning: thread.reasoning,
      switches: thread.switches ?? {},
    },
    approval: { mode: 'trust', interactive: false },
    progress: STARTING,
  };
}
export const settlePatch = Effect.fnUntraced(function* (
  status: 'completed' | 'failed' | 'aborted',
): Effect.fn.Return<ThreadRunSettlePatch> {
  const at = new Date(yield* Clock.currentTimeMillis);
  return { status, progress: { stage: status, message: null } satisfies ThreadRunProgress, finishedAt: at, heartbeatAt: at };
});
export const stopPatch = Effect.fnUntraced(function* (by: 'reader' | 'agent'): Effect.fn.Return<ThreadRunStopPatch> {
  const at = new Date(yield* Clock.currentTimeMillis);
  return {
    intent: { by, marker: false, withdraw: false },
    progress: { stage: 'aborted', message: 'Thread run stopped.' } satisfies ThreadRunProgress,
    finishedAt: at,
    heartbeatAt: at,
  };
});
export const ABANDONED = Effect.map(Clock.currentTimeMillis, (now) => ({
  kind: 'foreign-owner' as const,
  heartbeatBefore: new Date(now + 60_000),
}));
export const adoptInput = Effect.fnUntraced(function* (maxResumes: number) {
  return {
    selector: yield* ABANDONED,
    maxResumes,
    progress: { stage: THREAD_RUN_RESUMING_STAGE, message: null } satisfies ThreadRunProgress,
    heartbeatAt: new Date(yield* Clock.currentTimeMillis),
  };
});
export const reapPatch = Effect.fnUntraced(function* (selector: ThreadRunReapSelector) {
  return { selector, failureReason: 'Thread run was interrupted.', progress: REAPED, finishedAt: new Date(yield* Clock.currentTimeMillis) };
});
export function entry(id: string, runId?: string): ThreadTranscriptEntry {
  return { type: 'message', id, role: 'assistant', text: id, runId: runId };
}
