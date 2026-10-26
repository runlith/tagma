import { Context, Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { startingRun } from '@runlith/agent/protocol/realtime';
import { WithdrawFailed } from '@runlith/agent/thread/transport/contract';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadSaid } from '@runlith/agent/thread/run/scheduler/inputs';
import type { ThreadInputOptions } from '@runlith/agent/thread/keyed';
import type { ThreadRestarted, ThreadStop, ThreadWithdrawal } from '@runlith/agent/thread/ending';
import type { ThreadSteerInput } from '@runlith/agent/thread/run/scheduler/inputs';
import { type ThreadAttachmentRef, threadAttachmentIsPicture } from '@runlith/agent/transcript/attachments';
import { OPERATOR_PRINCIPAL, type Actor } from '../../platform/contract/wire/actor.js';
import type { FieldRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { THREAD_OPERATIONS } from '../contract/wire/operations/catalog.js';
import { gated, gateProject } from '../projectGate.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { withdrawFailed, type HarnessFailure } from '../contract/service/failure.js';
import { admitThreadFailures, attachmentRejected } from '../refusals.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadEnding } from '../ending.js';
import type { ThreadListProjection } from '../list/summary.js';
import { ReaderMarking } from './reader.js';

type SessionCode<K extends keyof typeof THREAD_OPERATIONS> = (typeof THREAD_OPERATIONS)[K]['refusals'][number] | FieldRefusal;

type Said = (
  threadId: string,
  projectId: number,
  text: string,
  attachments?: readonly ThreadAttachmentRef[],
  options?: ThreadInputOptions,
) => Effect.Effect<ThreadSaid, HarnessFailure>;

export class ThreadTurns extends Context.Service<
  ThreadTurns,
  {
    send: Said;
    queue: Said;
    steer(
      threadId: string,
      projectId: number,
      input: ThreadSteerInput,
      options?: ThreadInputOptions,
    ): Effect.Effect<ThreadSaid, HarnessFailure>;
    unqueue(threadId: string, projectId: number, inputId: string): Effect.Effect<boolean, HarnessFailure>;
    continueThread(
      threadId: string,
      projectId: number,
    ): Effect.Effect<
      { readonly runId: string } | { readonly status: 'already-running'; readonly runId: string },
      HarnessFailure<SessionCode<'continue_thread'>>
    >;
    restart(
      threadId: string,
      projectId: number,
      byThreadId: string | undefined,
    ): Effect.Effect<ThreadRestarted, HarnessFailure<SessionCode<'restart_thread'>>>;
    stop(
      threadId: string,
      projectId: number,
      expectedRunId?: string,
      options?: ThreadWithdrawal,
    ): Effect.Effect<ThreadStop, HarnessFailure>;
    archive(
      threadId: string,
      projectId: number,
      by: Actor,
    ): Effect.Effect<ThreadListProjection, HarnessFailure<SessionCode<'archive_thread'>>>;
    delete(threadId: string, projectId: number, by?: Actor): Effect.Effect<boolean, HarnessFailure<SessionCode<'delete_thread'>>>;
  }
>()('tagma/threads/ThreadTurns') {}

export const makeThreadTurns = Effect.gen(function* () {
  const threads = yield* ThreadLookup;
  const records = yield* ThreadRecords;
  const rollouts = yield* ThreadRollouts;
  const harness = yield* ThreadHarness;
  const core = (threadId: string) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
  const ending = yield* ThreadEnding;
  const reader = yield* ReaderMarking;
  const pictureRefusal = (row: { readonly provider: string; readonly model: string | null }): string =>
    `${row.provider}/${row.model ?? 'default'} takes no images on this thread, so a picture cannot reach it.`;

  const said =
    (road: 'send' | 'queue'): Said =>
    (threadId, projectId, text, attachments, options) =>
      rollouts.using(
        threadId,
        Effect.gen(function* () {
          yield* gateProject(records, threadId, projectId);
          yield* rollouts.rehydrate(threadId);
          const row = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
          if (row === undefined && attachments?.some((ref) => threadAttachmentIsPicture(ref.id))) {
            return yield* Effect.fail(new ThreadNotFoundError(threadId));
          }
          if (row !== undefined && !row.capabilities.pictures && attachments?.some((ref) => threadAttachmentIsPicture(ref.id))) {
            return yield* Effect.fail(attachmentRejected(`${pictureRefusal(row)} Send the words without the picture.`));
          }
          const spoken = yield* core(threadId)[road](text, attachments, options);
          if (spoken.replayed !== true) {
            yield* reader.wrote(threadId);
            yield* reader.spoke(threadId, projectId, text, spoken);
          }
          return spoken;
        }),
      );

  return ThreadTurns.of({
    send: said('send'),
    queue: said('queue'),

    steer: (threadId, projectId, input, options) =>
      gated(records, threadId, projectId, () =>
        Effect.tap(
          rollouts.using(
            threadId,
            Effect.flatMap(rollouts.rehydrate(threadId), () => core(threadId).steer(input, options)),
          ),
          (result) =>
            result.replayed === true
              ? Effect.void
              : reader.wrote(threadId).pipe(Effect.andThen(reader.spoke(threadId, projectId, input.text, result))),
        ),
      ),

    unqueue: (threadId, projectId, inputId) =>
      gated(records, threadId, projectId, () =>
        core(threadId)
          .unqueue(inputId)
          .pipe(
            Effect.mapError((failure) =>
              failure instanceof ThreadCallBroke && failure.cause instanceof WithdrawFailed
                ? withdrawFailed(failure.cause.reason)
                : failure,
            ),
          ),
      ),

    continueThread: (threadId, projectId) =>
      admitThreadFailures(
        gated(records, threadId, projectId, () =>
          rollouts.using(
            threadId,
            Effect.flatMap(rollouts.rehydrate(threadId), () => startingRun(core(threadId).continue())),
          ),
        ),
        THREAD_OPERATIONS.continue_thread.refusals,
      ),

    restart: (threadId, projectId, byThreadId) =>
      admitThreadFailures(
        gated(records, threadId, projectId, () =>
          rollouts.using(
            threadId,
            Effect.flatMap(rollouts.rehydrate(threadId), () => core(threadId).restart(byThreadId)),
          ),
        ),
        THREAD_OPERATIONS.restart_thread.refusals,
      ),

    stop: (threadId, projectId, expectedRunId, options = {}) =>
      ending.stop(threadId, projectId, expectedRunId, { ...options, door: 'stop_run' }),

    archive: (threadId, projectId, by) =>
      admitThreadFailures(ending.archive(threadId, projectId, by), THREAD_OPERATIONS.archive_thread.refusals),

    delete: (threadId, projectId, by) =>
      admitThreadFailures(ending.delete(threadId, projectId, by), THREAD_OPERATIONS.delete_thread.refusals),
  });
});
