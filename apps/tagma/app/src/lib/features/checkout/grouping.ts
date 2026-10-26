import type { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';

export const GROUPING = 'changes';

const EARLIER_GROUPING = 'checkout';

export const BY_THREAD = 'checkout-sections';

export function groupedIn(marks: ReaderMarks): boolean {
  const mark = marks.grouping.get(GROUPING);
  if (mark !== undefined) return mark === 'groups';
  return marks.grouping.get(EARLIER_GROUPING) === '';
}

export const byThread = (mark: string | undefined): boolean => mark === 'thread';
