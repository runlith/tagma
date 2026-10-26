import { Effect } from 'effect';
import { CallPlace } from '../platform/contract/service/place.js';
import { SignedCall } from '../platform/contract/service/writers.js';
import { journalRange } from '../graph/journal/callRange.js';

const namedBlock = (answer: unknown): string | undefined => {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const shaped = answer as { readonly status?: unknown; readonly block?: { readonly name?: unknown } };
  if (shaped.status !== 'ok' || typeof shaped.block?.name !== 'string') return undefined;
  return shaped.block.name;
};

export const journaled = Effect.fnUntraced(function* (answer: unknown) {
  const name = namedBlock(answer);
  const key = yield* SignedCall;
  const place = yield* CallPlace;
  if (name === undefined || key === null || place === null) return answer;
  const reading = yield* journalRange(place.projectId)(key, name);
  if (reading.status === 'unreadable') return { ...(answer as object), journalUnreadable: reading.reason };
  return reading.range === null ? answer : { ...(answer as object), journal: reading.range };
});
