import { Context, type Effect } from 'effect';
import type { ThreadEvictionVerdict, ThreadSweep } from '../wire/eviction.js';
import type { RolloutRepair, ThreadRolloutDisagreement } from '../wire/evidence.js';
import type { HarnessFailure } from './failure.js';
import type { ThreadGate } from '../../list/store.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export class ThreadRollouts extends Context.Service<
  ThreadRollouts,
  {
    pathOf(projectId: number, threadId: string): string | undefined;
    locate(threadId: string): Effect.Effect<string | undefined, StoreFailure>;
    appendRecord(threadId: string, record: unknown): void;
    appendMeta(threadId: string): Effect.Effect<void>;
    queueMeta(threadId: string): void;
    ensure(threadId: string): Effect.Effect<void, unknown>;
    behind(threadId: string): Effect.Effect<Effect.Effect<void, unknown>, unknown>;
    owed(threadId: string): Effect.Effect<void, unknown>;
    release(projectId: number, threadId: string): Effect.Effect<void>;
    freeing(threadIds: readonly string[]): Effect.Effect<Effect.Effect<void, HarnessFailure>, HarnessFailure>;
    rehydrate(threadId: string, read?: ThreadGate): Effect.Effect<void, HarnessFailure>;
    formRested(threadId: string): void;
    evict(projectId: number, threadId: string): Effect.Effect<ThreadEvictionVerdict, HarnessFailure>;
    sweep(): Effect.Effect<ThreadSweep, HarnessFailure>;
    shelve(threadIds: readonly string[]): void;
    readonly shelving: Effect.Effect<never>;
    using<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
    exportStanding(): Effect.Effect<number, HarnessFailure>;
    replay(): Effect.Effect<number, HarnessFailure>;
    repair(threadId: string, projectId: number): Effect.Effect<RolloutRepair, HarnessFailure>;
    report(threadId: string, projectId: number, records?: number): Effect.Effect<ThreadRolloutDisagreement, HarnessFailure>;
  }
>()('tagma/threads/ThreadRollouts') {}
