import type { LineCounts } from '@tagma/server/change-record/contract/wire/holdings';
import type { Link } from '$lib/features/opening/Link.js';
import { counted, uncheckedWords, unprovenWords } from './holdingWords.js';
import { lineCount } from './lineCount.js';
import { type ChangesRef, changesLink } from './links.js';
import { entriesIn, type ThreadChanges } from './ThreadChanges.svelte.js';

export type ChangesTail =
  | { readonly kind: 'lines'; readonly lines: LineCounts }
  | { readonly kind: 'files'; readonly count: number }
  | { readonly kind: 'unchecked'; readonly count: number };

export function changesTail(changes: ThreadChanges): ChangesTail | null {
  if (lineCount(changes.uncommitted) !== null) return { kind: 'lines', lines: changes.uncommitted };
  const paths = changes.held?.paths ?? 0;
  if (paths > 0) return { kind: 'files', count: paths };
  const unproven = changes.held?.unproven ?? 0;
  return unproven > 0 ? { kind: 'unchecked', count: unproven } : null;
}

export function threadChangesLink(changes: ThreadChanges): Link<ChangesRef> {
  const paths = changes.held?.paths ?? 0;
  const unproven = changes.held?.unproven ?? 0;
  const lines = lineCount(changes.uncommitted);
  const summary = [
    [
      ...(paths > 0 ? [counted(paths, 'file', 'files')] : []),
      ...(lines?.kind === 'lines' ? [[lines.added, lines.removed].filter((part) => part !== null).join(' ')] : []),
      ...(unproven > 0 ? [uncheckedWords(unproven)] : []),
    ].join(', '),
    ...new Set(changes.checkouts.flatMap((checkout) => entriesIn(checkout, 'unproven').map((entry) => unprovenWords(entry.reason)))),
  ]
    .filter((part) => part !== '')
    .join('\n');
  return changesLink({ threadId: changes.threadId, summary: summary === '' ? undefined : summary });
}
