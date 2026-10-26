import { Effect } from 'effect';
import type { Actor } from '../platform/contract/wire/actor.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadInputRefused, type HarnessFailure } from './contract/service/failure.js';

export const lineageOf = (by: Actor): string | null => (by.kind === 'thread' ? by.threadId : null);

export const refuseOwnLineage = Effect.fnUntraced(function* (
  records: ThreadRecords['Service'],
  threadId: string,
  by: Actor,
): Effect.fn.Return<void, HarnessFailure> {
  if (by.kind !== 'thread' || (yield* records.relation(threadId, by.threadId)) !== 'lineage') return;
  return yield* Effect.fail(
    new ThreadInputRefused(
      'own-lineage',
      `Thread ${threadId} is ${threadId === by.threadId ? 'the calling thread itself' : `an ancestor of the calling thread ${by.threadId}`}; deleting it would end the thread that asks, in every mode.`,
      [
        'delete a thread spawned under you, or one outside your lineage',
        'archive it instead: that is reversible',
        'the operator deletes it',
      ],
    ),
  );
});
