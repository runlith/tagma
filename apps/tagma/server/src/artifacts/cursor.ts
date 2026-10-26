import { mintCursor, type PageKey, type PageQuestion, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import type { ShelfKey } from './contract/service/shelf.js';
import { ARTIFACT_ROWS } from './contract/wire/operations.js';

const QUESTION: PageQuestion = { operation: 'list_artifacts', selection: {}, order: ARTIFACT_ROWS.order };

const shelfKey = (key: PageKey): ShelfKey | null => {
  const [epoch, snapshot, total, seq] = key;
  const counts = [epoch, snapshot, total, seq];
  if (key.length !== 4 || !counts.every((part) => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)) return null;
  return { epoch: epoch as number, snapshot: snapshot as number, total: total as number, seq: seq as number };
};

export const readShelfCursor = Effect.fnUntraced(function* (cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  const read = readCursor(cursor, QUESTION);
  if ('refused' in read) return yield* cursorRefusal(read.refused);
  const after = shelfKey(read.at);
  if (after === null) return yield* cursorRefusal('bad-cursor');
  return after;
});

export const shelfCursor = (key: ShelfKey): string => mintCursor(QUESTION, [key.epoch, key.snapshot, key.total, key.seq]);
