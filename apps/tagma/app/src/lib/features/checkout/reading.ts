import type { CheckoutSequencerKind, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';

export const SHORT_SHA = 7;

export const headOf = (row: CheckoutState): string =>
  !row.repository ? 'no Git' : (row.ref ?? (row.head === null ? 'unborn' : `detached at ${row.head.slice(0, SHORT_SHA)}`));

export function readingNote(row: CheckoutState): string | null {
  const said = [
    ...(row.stale ? ['the last reading could not be taken'] : []),
    ...(row.incomplete ? ['the answer passed this reading’s capture, so the lists are not the tree’s'] : []),
    ...(row.unwatched ? ['nothing watches this checkout — edits outside Tagma’s doors arrive on the next mark'] : []),
  ];
  return said.length === 0 ? null : said.join(' · ');
}

export function readingWord(row: CheckoutState): string | null {
  if (row.stale) return 'Out of date · Retry';
  if (row.incomplete) return 'Partial list';
  if (row.unwatched) return 'Not watched';
  return null;
}

export const OPERATION_WORD: Record<Exclude<CheckoutSequencerKind, 'none'>, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  am: 'Patch apply',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};
