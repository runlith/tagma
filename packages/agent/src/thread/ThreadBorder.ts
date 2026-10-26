import { Data, Effect } from 'effect';
import {
  ThreadCompactionConflictError,
  ThreadCompactionExhaustedError,
  ThreadCompactionOffError,
  ThreadNoSummarizerError,
  ThreadSummaryFailedError,
} from './storage/compaction';
import { ThreadNotFoundError } from './storage/aggregate';
import { RunActRefused, ThreadRunConflictError, ThreadRunHeldError, ThreadRunKeyReusedError } from './storage/runs';
import { SequenceUnavailable, ThreadActReusedError, ThreadActSpentError, ThreadVersionStaleError } from './transition/port';
import { causeSentence, ThreadStorageFailed } from './persisted';
import { ThreadModelNotServed } from './compaction/CompactionModels';

export class ThreadMissing extends Data.TaggedError('ThreadMissing')<{ readonly threadId: string }> {
  override get message(): string {
    return `Thread ${this.threadId} does not exist.`;
  }
}

export class ThreadCallBroke extends Data.TaggedError('ThreadCallBroke')<{ readonly cause: unknown }> {
  override get message(): string {
    return causeSentence(this.cause);
  }
}

export type ThreadPortRefusal =
  | ThreadNotFoundError
  | ThreadRunConflictError
  | ThreadRunKeyReusedError
  | RunActRefused
  | ThreadRunHeldError
  | ThreadCompactionConflictError
  | ThreadCompactionExhaustedError
  | ThreadCompactionOffError
  | ThreadNoSummarizerError
  | ThreadSummaryFailedError
  | ThreadActReusedError
  | ThreadActSpentError
  | SequenceUnavailable
  | ThreadVersionStaleError
  | ThreadModelNotServed;

export function isPortRefusal(value: unknown): value is ThreadPortRefusal {
  return (
    value instanceof ThreadNotFoundError ||
    value instanceof ThreadRunConflictError ||
    value instanceof ThreadRunKeyReusedError ||
    value instanceof RunActRefused ||
    value instanceof ThreadRunHeldError ||
    value instanceof ThreadCompactionConflictError ||
    value instanceof ThreadCompactionExhaustedError ||
    value instanceof ThreadCompactionOffError ||
    value instanceof ThreadNoSummarizerError ||
    value instanceof ThreadSummaryFailedError ||
    value instanceof ThreadActReusedError ||
    value instanceof ThreadActSpentError ||
    value instanceof SequenceUnavailable ||
    value instanceof ThreadVersionStaleError ||
    value instanceof ThreadModelNotServed
  );
}

export function threadCall<A>(work: () => Promise<A>): Effect.Effect<A, ThreadCallBroke> {
  return Effect.tryPromise({ try: work, catch: (cause) => new ThreadCallBroke({ cause }) });
}

export type ThreadPortFailure = ThreadPortRefusal | ThreadStorageFailed;

export type ThreadBorderFailed = ThreadPortRefusal | ThreadStorageFailed | ThreadCallBroke;

export function isThreadBorderFailure(value: unknown): value is ThreadBorderFailed {
  return value instanceof ThreadStorageFailed || value instanceof ThreadCallBroke || isPortRefusal(value);
}

export function bordered<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, ThreadBorderFailed, R> {
  return Effect.mapError(work, (failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure })));
}

export function threadBorderOut<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> {
  return Effect.catch(work, (failure) => Effect.die(threadCauseOf(failure)));
}

export function threadCauseOf(failure: unknown): unknown {
  return failure instanceof ThreadCallBroke || failure instanceof ThreadStorageFailed ? failure.cause : failure;
}

export function storageFailed(call: string): (failure: ThreadBorderFailed) => ThreadStorageFailed {
  return (failure) => (failure instanceof ThreadStorageFailed ? failure : new ThreadStorageFailed({ call, cause: threadCauseOf(failure) }));
}
