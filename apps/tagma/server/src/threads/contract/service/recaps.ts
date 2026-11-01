import { Context, type Effect } from 'effect';
import type { StoredFailure } from '../../../platform/store/crossing.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadRecap } from '../../../thread-record/contract/wire/recap.js';
import type { RecapAttempt, RecapReading } from '../wire/recap.js';

export type RecapSubject = { readonly id: string; readonly projectId: number | null };

export class ThreadRecaps extends Context.Service<
  ThreadRecaps,
  {
    readings(subjects: readonly RecapSubject[]): Effect.Effect<ReadonlyMap<string, RecapReading>, StoredFailure>;
    reading(subject: RecapSubject, stored: ThreadRecap | null, unit?: Unit<'machine'>): Effect.Effect<RecapReading | null, StoredFailure>;
    attempt(threadId: string): RecapAttempt | null;
    track(threadId: string, attempt: RecapAttempt | null): void;
  }
>()('tagma/threads/ThreadRecaps') {}
