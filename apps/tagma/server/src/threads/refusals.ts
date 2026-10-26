import { Cause, Data, Effect } from 'effect';
import { THREAD_ATTACHMENT_MEDIA_TYPES } from '@runlith/agent/transcript/attachments';
import { ThreadCallBroke, threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadInteractionConflictError, ThreadQuestionNotFound } from '@runlith/agent/thread/run/ThreadQuestion';
import {
  ThreadNoSummarizerError,
  ThreadCompactionConflictError,
  ThreadCompactionOffError,
  ThreadSummaryFailedError,
} from '@runlith/agent/thread/storage/compaction';
import { TransportCannotError, TRANSPORT_CANNOT_WAYS } from '@runlith/agent/thread/record';
import { ThreadRewindRefusedError, type ThreadRewindRefusal } from '@runlith/agent/thread/rewind';
import { SequenceUnavailable, ThreadActReusedError, ThreadActSpentError } from '@runlith/agent/thread/transition/port';
import { ThreadDeleteConflictError, ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { ThreadRunConflictError, ThreadRunNotHeldError, ThreadRunNotInterruptedError } from '@runlith/agent/thread/storage/runs';
import { ModeUnknown } from '@runlith/agent/modes/ApprovalMode';
import { planeRefusalOf } from '@runlith/agent/collaboration/planeRefusal';
import { ThreadModelNotServed } from '@runlith/agent/thread/compaction/CompactionModels';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { modeRefusal } from './contract/service/modes.js';
import { GateRefusal, type FieldRefusal, type Unblock } from '../platform/contract/wire/refusal.js';
import { admits } from '../platform/contract/service/routed.js';
import {
  ThreadAttachmentMissing,
  ThreadInputRefused,
  ThreadRefused,
  ThreadWriteConflict,
  type HarnessFailure,
} from './contract/service/failure.js';

export const admitThreadFailures = <A, E extends HarnessFailure, R, Code extends string>(
  work: Effect.Effect<A, E, R>,
  admitted: readonly Code[],
): Effect.Effect<A, HarnessFailure<Code | FieldRefusal>, R> =>
  work.pipe(
    Effect.catchCause((cause): Effect.Effect<never, HarnessFailure<Code | FieldRefusal>> => {
      const failure = threadCauseOf(Cause.squash(cause));
      const said = kernelRefusal(failure) ?? inputRefusal(failure) ?? planeRefusal(failure);
      const code = said?.code ?? (failure instanceof GateRefusal ? failure.code : null);
      return Effect.andThen(
        code === null ? Effect.void : admits(admitted, code),
        Effect.failCause(cause as Cause.Cause<HarnessFailure<Code | FieldRefusal>>),
      );
    }),
  );

export type ThreadFailure<Code extends string, Kernel = never> =
  | GateRefusal<Code>
  | ThreadInputRefused<Code>
  | Kernel
  | ThreadStorageFailed
  | ThreadCallBroke
  | StoreFailure;

export type KernelRefusal =
  | 'not-found'
  | 'foreign-project'
  | 'interaction-conflict'
  | 'delete-conflict'
  | 'thread-gone'
  | 'compaction-conflict'
  | 'run-not-interrupted'
  | 'run-not-held'
  | 'run-active'
  | 'no-summarizer'
  | 'summary-failed'
  | 'compaction-off'
  | 'key-reused'
  | 'act-spent'
  | 'sequence-unavailable'
  | 'transport-cannot'
  | 'mode-unknown'
  | 'provider-not-installed'
  | ThreadRewindRefusal;

export type BorderCode<E> = E extends StoreFailure
  ? never
  : E extends GateRefusal<infer Code>
    ? Code
    : E extends ThreadInputRefused<infer Code>
      ? Code
      : E extends ThreadNotFoundError | ThreadAttachmentMissing
        ? never
        : E extends ThreadRefused
          ? 'foreign-project'
          : E extends ThreadQuestionNotFound
            ? 'not-found'
            : E extends ThreadInteractionConflictError
              ? 'interaction-conflict'
              : E extends ThreadDeleteConflictError
                ? 'delete-conflict'
                : E extends ThreadWriteConflict
                  ? 'thread-gone'
                  : E extends ThreadCompactionConflictError
                    ? 'compaction-conflict'
                    : E extends ThreadRunNotInterruptedError
                      ? 'run-not-interrupted'
                      : E extends ThreadRunNotHeldError
                        ? 'run-not-held'
                        : E extends ThreadRunConflictError
                          ? 'run-active'
                          : E extends ThreadNoSummarizerError
                            ? 'no-summarizer'
                            : E extends ThreadSummaryFailedError
                              ? 'summary-failed'
                              : E extends ThreadCompactionOffError
                                ? 'compaction-off'
                                : E extends ThreadRewindRefusedError
                                  ? ThreadRewindRefusal
                                  : E extends TransportCannotError
                                    ? 'transport-cannot'
                                    : E extends ThreadActReusedError
                                      ? 'key-reused'
                                      : E extends ThreadActSpentError
                                        ? 'act-spent'
                                        : E extends SequenceUnavailable
                                          ? 'sequence-unavailable'
                                          : E extends ThreadModelNotServed
                                            ? 'provider-not-installed'
                                            : never;

const REWIND_WAYS_ON: Record<ThreadRewindRefusal, Unblock> = {
  'rewind-summarized': ['branch from a turn after the last compaction, or start a thread from what the summary holds'],
  'rewind-rewound': ['restore that rewind first, or name a turn that still stands'],
  'rewind-unknown': ['read_rewind_points lists the turns a rewind can name'],
  'restore-superseded': ['a turn ran or a compaction settled after that rewind; rewind again from a turn that stands'],
  'restore-unknown': ['read_rewind_points lists the rewinds that stand'],
};

type Reworded = { readonly code: KernelRefusal; readonly reason: string; readonly unblock: Unblock };

function kernelRefusal(failure: unknown): Reworded | null {
  if (failure instanceof ThreadRefused) {
    return {
      code: 'foreign-project',
      reason: failure.message,
      unblock: [`read it with project: ${failure.projectId}`],
    };
  }
  if (failure instanceof ThreadQuestionNotFound) {
    return { code: 'not-found', reason: failure.message, unblock: ['reopen the thread and choose one of its open questions'] };
  }
  if (failure instanceof ThreadInteractionConflictError) {
    return {
      code: 'interaction-conflict',
      reason: failure.message,
      unblock: ['reopen the thread and read what it says now'],
    };
  }
  if (failure instanceof ThreadDeleteConflictError) {
    return { code: 'delete-conflict', reason: failure.message, unblock: ['stop the thread, then delete it again'] };
  }
  if (failure instanceof ThreadWriteConflict) {
    return {
      code: 'thread-gone',
      reason: failure.message,
      unblock: ["read the project's thread list again; this thread is no longer in it"],
    };
  }
  if (failure instanceof ThreadCompactionConflictError) {
    return {
      code: 'compaction-conflict',
      reason: failure.message,
      unblock: ['reopen the thread and compact it again'],
    };
  }
  if (failure instanceof ThreadRunNotInterruptedError) {
    return {
      code: 'run-not-interrupted',
      reason: failure.message,
      unblock: [
        'read the thread again; Continue takes up a run that was cut or stopped, never one that finished',
        'send this thread a turn of its own to open new work',
      ],
    };
  }
  if (failure instanceof ThreadRunNotHeldError) {
    return {
      code: 'run-not-held',
      reason: failure.message,
      unblock: ['send the same call again: the server that holds the run answers it'],
    };
  }
  if (failure instanceof ThreadRunConflictError) {
    return {
      code: 'run-active',
      reason: failure.message,
      unblock: [`follow run ${failure.runId}, or stop it before starting another`],
    };
  }
  if (failure instanceof TransportCannotError) {
    return { code: 'transport-cannot', reason: failure.message, unblock: TRANSPORT_CANNOT_WAYS };
  }
  if (failure instanceof ThreadActReusedError) {
    return {
      code: 'key-reused',
      reason: failure.message,
      unblock: ['send the changed request under a new key', 'send the same request again under this key to read what it did'],
    };
  }
  if (failure instanceof SequenceUnavailable) {
    return {
      code: 'sequence-unavailable',
      reason: failure.message,
      unblock: ['read the thread as it stands now', 'send a new turn to open new work'],
    };
  }
  if (failure instanceof ThreadModelNotServed) {
    return {
      code: 'provider-not-installed',
      reason: failure.message,
      unblock: [`install the adapter that provides ${failure.provider}`, 'move the thread to a model an installed adapter serves'],
    };
  }
  if (failure instanceof ThreadActSpentError) {
    return {
      code: 'act-spent',
      reason: failure.message,
      unblock: ['read the thread as it stands now', 'send a new act under a new key'],
    };
  }
  if (failure instanceof ThreadRewindRefusedError) {
    return { code: failure.code, reason: failure.message, unblock: REWIND_WAYS_ON[failure.code] };
  }
  if (failure instanceof ModeUnknown) return modeRefusal(failure);
  if (failure instanceof ThreadCompactionOffError) {
    return {
      code: 'compaction-off',
      reason: failure.message,
      unblock: ["name a compaction strategy in the agent's definition, or leave the field out for the standing one"],
    };
  }
  if (failure instanceof ThreadSummaryFailedError) {
    return {
      code: 'summary-failed',
      reason: failure.message,
      unblock: [
        failure.reason === 'model' || failure.reason === 'no-fit'
          ? 'compact again, or name another summarizer from read_compaction_choices'
          : 'compact again: the summarizer answered with a summary the thread cannot keep',
      ],
    };
  }
  if (failure instanceof ThreadNoSummarizerError) {
    return {
      code: 'no-summarizer',
      reason: failure.message,
      unblock: [
        'name the summarizer yourself: any row read_compaction_choices answers, the thread’s own model included',
        'add a spendable model to agent.compactionSummarizers',
        'set agent.compactionSummarizerRule to never, and the thread’s own model summarizes',
      ],
    };
  }
  return null;
}

export const harnessRefusal = <A, E extends HarnessFailure, R, Code extends string = BorderCode<E>>(
  work: Effect.Effect<A, E, R>,
  admitted?: readonly Code[],
): Effect.Effect<A, GateRefusal<Code | FieldRefusal> | StoreFailure | BodyMissing, R> =>
  work.pipe(
    Effect.catchCause((cause): Effect.Effect<never, GateRefusal<Code | FieldRefusal> | StoreFailure | BodyMissing> => {
      const raised = Cause.squash(cause);
      const failure = threadCauseOf(raised);
      if (failure instanceof ThreadNotFoundError || failure instanceof ThreadAttachmentMissing) {
        return Effect.fail(
          new BodyMissing({
            reason: failure.message,
            unblock: ['a thread is opened from the project that holds it, and its attachments through it'],
          }),
        );
      }
      const said = kernelRefusal(failure) ?? inputRefusal(failure) ?? planeRefusal(failure);
      const admission = (code: string) => (admitted === undefined ? Effect.void : admits(admitted, code));
      if (said !== null) {
        return Effect.andThen(
          admission(said.code),
          Effect.fail(new GateRefusal(said.code, said.reason, said.unblock) as GateRefusal<Code | FieldRefusal>),
        );
      }
      if (failure instanceof GateRefusal) {
        return Effect.andThen(admission(failure.code), Effect.fail(failure as GateRefusal<Code | FieldRefusal>));
      }
      if (raised instanceof ThreadStorageFailed || raised instanceof ThreadCallBroke) return Effect.die(failure);
      return Effect.failCause(cause as Cause.Cause<GateRefusal<Code> | StoreFailure>);
    }),
  );

function inputRefusal(failure: unknown): { readonly code: string; readonly reason: string; readonly unblock: Unblock } | null {
  return failure instanceof ThreadInputRefused ? { code: failure.code, reason: failure.message, unblock: failure.unblock } : null;
}

function planeRefusal(failure: unknown): { readonly code: string; readonly reason: string; readonly unblock: Unblock } | null {
  const plane = planeRefusalOf(failure);
  return plane === null ? null : { code: plane.code, reason: plane.reason, unblock: plane.unblock };
}

export class BodyMissing extends Data.TaggedError('BodyMissing')<{
  readonly reason: string;
  readonly unblock: Unblock;
}> {
  readonly code = 'not-found' as const;
}

export function attachmentRejected(message: string): ThreadInputRefused<'attachment-rejected'> {
  return new ThreadInputRefused('attachment-rejected', message, [
    `send the bytes the content-type declares: ${THREAD_ATTACHMENT_MEDIA_TYPES.join(', ')}`,
  ]);
}
