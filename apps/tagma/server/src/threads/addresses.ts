import { Context, Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';
import { ThreadRecords, type RecordAddress } from '../thread-record/contract/service/records.js';

const Addressed = Context.Reference<Map<string, RecordAddress | null> | null>('tagma/threads/Addressed', { defaultValue: () => null });

export const addressCall = () => Context.make(Addressed, new Map<string, RecordAddress | null>());

export const addressed = Effect.fnUntraced(function* (address: string, caller: Caller) {
  const resolved = yield* Addressed;
  const known = resolved?.get(address);
  if (known !== undefined) return known;
  const actor = caller.actor;
  const found = yield* (yield* ThreadRecords).address(
    address,
    actor.kind === 'thread' ? { threadId: actor.threadId, projectId: actor.projectId } : { threadId: null, projectId: null },
  );
  resolved?.set(address, found);
  return found;
});
