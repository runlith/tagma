import { type ChangeDesc, ChangeSet, type ChangeSpec, type Text } from '@codemirror/state';
import { checkLineEdits, type LineEdit, type LineEditsRefused } from '@runlith/files/lines';
import { Result } from 'effect';

export const SEPARATOR = '\n';

export type LineSpan = { readonly a0: number; readonly a1: number; readonly b0: number; readonly b1: number };

const startOf = (doc: Text, line: number): number => (line < doc.lines ? doc.line(line + 1).from : doc.length + 1);

function spec(doc: Text, { from, to, lines }: LineEdit): ChangeSpec {
  const start = startOf(doc, from);
  const end = startOf(doc, to);
  const insert = lines.map((line) => line + SEPARATOR).join('');
  if (end <= doc.length) return { from: start, to: end, insert };
  if (start > doc.length) return { from: doc.length, insert: SEPARATOR + insert.slice(0, -1) };
  if (insert.length > 0) return { from: start, to: doc.length, insert: insert.slice(0, -1) };
  return { from: Math.max(start - 1, 0), to: doc.length };
}

export function changeSetOf(base: Text, edits: readonly LineEdit[]): Result.Result<ChangeSet, LineEditsRefused> {
  const refused = checkLineEdits(base.lines, edits);
  if (refused !== undefined) return Result.fail(refused);
  const merged: LineEdit[] = [];
  for (const edit of edits) {
    if (edit.from === edit.to && edit.lines.length === 0) continue;
    const last = merged.at(-1);
    if (last !== undefined && last.to === edit.from)
      merged[merged.length - 1] = { from: last.from, to: edit.to, lines: [...last.lines, ...edit.lines] };
    else merged.push(edit);
  }
  return Result.succeed(
    ChangeSet.of(
      merged.map((edit) => spec(base, edit)),
      base.length,
      SEPARATOR,
    ),
  );
}

export function lineSpans(changes: ChangeDesc, before: Text, after: Text): LineSpan[] {
  const found: LineSpan[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const endA = before.lineAt(toA);
    const endB = after.lineAt(toB);
    const whole = toA === endA.from && toB === endB.from;
    const span = {
      a0: before.lineAt(fromA).number - 1,
      a1: whole ? endA.number - 1 : endA.number,
      b0: after.lineAt(fromB).number - 1,
      b1: whole ? endB.number - 1 : endB.number,
    };
    const open = found.at(-1);
    if (open !== undefined && span.a0 < open.a1)
      found[found.length - 1] = { a0: open.a0, a1: Math.max(open.a1, span.a1), b0: open.b0, b1: Math.max(open.b1, span.b1) };
    else found.push(span);
  });
  return found;
}

export function lineEditsOf(changes: ChangeDesc, before: Text, after: Text): LineEdit[] {
  return lineSpans(changes, before, after).map(({ a0, a1, b0, b1 }) => {
    const lines: string[] = [];
    for (let at = b0; at < b1; at += 1) lines.push(after.line(at + 1).text);
    return { from: a0, to: a1, lines };
  });
}
