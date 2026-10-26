import { Data, Effect } from 'effect';
import { isPortRefusal, type ThreadBorderFailed, ThreadCallBroke, type ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { GateRefusal, type Unblock } from '../../../platform/contract/wire/refusal.js';

export type HarnessFailure<Code extends string = string> =
  | GateRefusal<Code>
  | StoreFailure
  | ThreadInputRefused<Code>
  | ThreadNotFoundError
  | ThreadAttachmentMissing
  | ThreadStorageFailed
  | ThreadCallBroke
  | (string extends Code ? ThreadBorderFailed | ThreadRefused | ThreadWriteConflict : never);

export class ThreadInputRefused<Code extends string = string> extends Data.TaggedError('ThreadInputRefused')<{
  readonly code: Code;
  readonly message: string;
  readonly unblock: Unblock;
}> {
  constructor(code: Code, message: string, unblock: Unblock) {
    super({ code, message, unblock });
  }
}

export class ThreadRefused extends Data.TaggedError('ThreadRefused')<{
  readonly threadId: string;
  readonly projectId: number;
  readonly message: string;
}> {
  readonly reason = 'other-project' as const;
  constructor(threadId: string, projectId: number) {
    super({ threadId, projectId, message: `Thread ${threadId} is held by project ${projectId}.` });
  }
}

export class ThreadWriteConflict extends Data.TaggedError('ThreadWriteConflict')<{
  readonly threadId: string;
  readonly message: string;
}> {
  constructor(threadId: string) {
    super({ threadId, message: `Thread ${threadId} was removed while this change was being written.` });
  }
}

export class ThreadAttachmentMissing extends Data.TaggedError('ThreadAttachmentMissing')<{ readonly message: string }> {
  constructor(attachmentId: string) {
    super({ message: `Thread attachment ${attachmentId} not found.` });
  }
}

export const withdrawFailed = (reason: string): GateRefusal<'withdraw-failed'> =>
  new GateRefusal('withdraw-failed', `The agent could not take these words back: ${reason}`, [
    'read the thread; the words stand among its unread steers until the agent reads them',
  ]);

export function threadCallFailed(cause: unknown): ThreadCallBroke {
  return new ThreadCallBroke({ cause });
}

export const failedAs = <A>(call: string, work: Effect.Effect<A, unknown>): Effect.Effect<A, ThreadPortFailure> =>
  Effect.mapError(work, (cause) =>
    cause instanceof ThreadStorageFailed || isPortRefusal(cause) ? cause : new ThreadStorageFailed({ call, cause }),
  );
