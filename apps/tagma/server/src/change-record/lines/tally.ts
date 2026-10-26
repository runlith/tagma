import { textChanges } from '@runlith/utils/patch';

export type LineTally = { readonly added: number; readonly removed: number };

export type Tallied = { readonly origin: 'edit' | 'write' | 'delete'; readonly oldText: string | null; readonly newText: string | null };

export function tallyOf(row: Tallied): LineTally | null {
  const next = row.origin === 'delete' ? '' : row.newText;
  if (row.oldText === null || next === null) return null;
  const diff = textChanges(row.oldText, next);
  return diff.timedOut ? null : { added: diff.added, removed: diff.removed };
}
