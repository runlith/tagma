import { Effect } from 'effect';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { ThreadRefused, type HarnessFailure } from './contract/service/failure.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';

export function ownedProject(records: ThreadRecords['Service'], threadId: string): Effect.Effect<number, HarnessFailure> {
  return Effect.flatMap(records.projectOf(threadId), (projectId) =>
    projectId === undefined ? Effect.fail(new ThreadNotFoundError(threadId)) : Effect.succeed(projectId),
  );
}

export function gateProject(records: ThreadRecords['Service'], threadId: string, expected: number): Effect.Effect<number, HarnessFailure> {
  return Effect.flatMap(ownedProject(records, threadId), (projectId) =>
    projectId === expected ? Effect.succeed(projectId) : Effect.fail(new ThreadRefused(threadId, projectId)),
  );
}

export function gated<A, R>(
  records: ThreadRecords['Service'],
  threadId: string,
  expected: number,
  work: () => Effect.Effect<A, HarnessFailure, R>,
): Effect.Effect<A, HarnessFailure, R> {
  return Effect.flatMap(gateProject(records, threadId, expected), work);
}
