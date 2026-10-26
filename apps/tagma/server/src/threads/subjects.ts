import { Effect } from 'effect';
import type { SubjectPlace } from '../platform/contract/service/place.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { addressCall, addressed } from './addresses.js';

const threadPlace = Effect.fn('threads.threadPlace')(function* (address: string, _operation: string, caller: Caller) {
  const found = yield* addressed(address, caller);
  return found === null ? null : { projectId: found.projectId, checkout: null, branch: null };
});

const canonical = (address: string, caller: Caller) => Effect.map(addressed(address, caller), (found) => found?.threadId ?? null);

export const THREAD_SUBJECTS: readonly SubjectPlace[] = [{ kind: 'thread', place: threadPlace, call: addressCall, canonical }];
