import { Effect } from 'effect';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { ThreadGate } from '../list/store.js';
import { ThreadRefused, type HarnessFailure } from '../contract/service/failure.js';

export function gatedByProject<A, R>(
  threads: { gateFacet(id: string): Effect.Effect<ThreadGate | undefined, StoreFailure> },
  threadId: string,
  expected: number,
  work: (facet: ThreadGate) => Effect.Effect<A, HarnessFailure, R>,
): Effect.Effect<A, HarnessFailure, R> {
  return Effect.flatMap(threads.gateFacet(threadId), (facet) =>
    facet === undefined
      ? Effect.fail(new ThreadNotFoundError(threadId))
      : facet.projectId === expected
        ? work(facet)
        : Effect.fail(new ThreadRefused(threadId, facet.projectId)),
  );
}
