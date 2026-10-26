import type { UnprovenReason } from '@tagma/server/change-record/contract/wire/holdings';
import type { LineEndReason } from '@tagma/server/change-record/contract/wire/threadChanges';

export function unprovenWords(reason: UnprovenReason): string {
  if (reason.kind === 'budget') return 'Too large to compare line by line';
  if (reason.kind === 'opaque') return `${reason.cause} (${reason.side}${reason.row === null ? '' : `, recorded write ${reason.row}`})`;
  if (reason.kind === 'worker') return `The reader stopped: ${reason.cause}`;
  return `Could not read the ${reason.side} side: ${reason.cause}`;
}

export const END_WORDS: Record<LineEndReason, string> = {
  reverted: 'Returned to HEAD',
  overwritten: 'Overwritten',
  formed: 'Reshaped by commit steps',
  'thread-deleted': 'Thread deleted',
  'checkout-gone': 'Checkout removed',
  outside: 'Released on an ignored path',
};

export const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const uncheckedWords = (count: number): string => `${count} unchecked`;

export const heldWords = (paths: number, unchecked: number): string =>
  [counted(paths, 'file', 'files'), ...(unchecked > 0 ? [uncheckedWords(unchecked)] : [])].join(' · ');
