import type { DocumentFrame } from '@tagma/server/checkout-files/contract/wire/document';
import { type Deadline, myersAlignment, OUTSIDE, type Sequence } from '@runlith/utils/sequenceDiff';

export type LineEdit = Extract<DocumentFrame, { readonly kind: 'change' }>['edits'][number];

const BOM = '\uFEFF';

const EXACT: Deadline = { expired: () => false };

export const lfText = (text: string): string => (text.startsWith(BOM) ? text.slice(BOM.length) : text).replace(/\r\n/g, '\n');

export function applyEdits(text: string, edits: readonly LineEdit[]): string | null {
  const lines = text.split('\n');
  const out: string[] = [];
  let at = 0;
  for (const edit of edits) {
    if (edit.from < at || edit.to < edit.from || edit.to > lines.length) return null;
    out.push(...lines.slice(at, edit.from), ...edit.lines);
    at = edit.to;
  }
  out.push(...lines.slice(at));
  return out.join('\n');
}

function sequenceOf(lines: readonly string[], ids: Map<string, number>): Sequence {
  const hashes = lines.map((line) => {
    const known = ids.get(line);
    if (known !== undefined) return known;
    ids.set(line, ids.size);
    return ids.size - 1;
  });
  return {
    length: hashes.length,
    element: (offset) => hashes[offset] ?? OUTSIDE,
    stronglyEqual: (one, other) => hashes[one] === hashes[other],
    boundaryScore: () => 0,
  };
}

export function diffLines(before: string, after: string): readonly LineEdit[] {
  const one = lfText(before).split('\n');
  const two = lfText(after).split('\n');
  if (one.length === two.length && one.every((line, at) => line === two[at])) return [];
  const ids = new Map<string, number>();
  const aligned = myersAlignment(sequenceOf(one, ids), sequenceOf(two, ids), EXACT);
  return aligned.changes
    .filter((change) => change.before.end > change.before.start || change.after.end > change.after.start)
    .map((change) => ({ from: change.before.start, to: change.before.end, lines: two.slice(change.after.start, change.after.end) }));
}

export function bufferRanges(edits: readonly LineEdit[]): readonly { readonly from: number; readonly to: number }[] {
  let shift = 0;
  return edits.map((edit) => {
    const from = edit.from + shift;
    shift += edit.lines.length - (edit.to - edit.from);
    return { from, to: from + Math.max(edit.lines.length, 1) };
  });
}
