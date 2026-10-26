import { Result } from 'effect';
import { alignLines } from '@runlith/utils/lineAlign';
import { type Change, deadlineIn } from '@runlith/utils/sequenceDiff';
import { applyLineEdits, lineBody, splitLines, type LineEdit } from '@runlith/files/lines';

export const DIFF_MS = 1500;

export const INLINE_CHARS = 200_000;

export const INLINE_LINES = 800;

export type Aligned = { readonly edits: readonly LineEdit[] | null } | 'heavy';

function align(before: string, after: string, ms: number, limit: number): Aligned {
  const standing = splitLines(before);
  const next = splitLines(after);
  let head = 0;
  const shortest = Math.min(standing.length, next.length);
  while (head < shortest && standing[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < shortest - head && standing[standing.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  const middleBefore = standing.slice(head, standing.length - tail);
  const middleAfter = next.slice(head, next.length - tail);
  if (Math.max(middleBefore.length, middleAfter.length) > limit) return 'heavy';
  const changes: readonly Change[] =
    middleBefore.length === 0 && middleAfter.length === 0
      ? []
      : alignLines(middleBefore.map(lineBody), middleAfter.map(lineBody), deadlineIn(ms)).changes;
  const edits = changes.map((change): LineEdit => ({
    from: head + change.before.start,
    to: head + change.before.end,
    lines: middleAfter.slice(change.after.start, change.after.end).map(lineBody),
  }));
  const applied = applyLineEdits(before, edits);
  return { edits: Result.isSuccess(applied) && applied.success === after ? edits : null };
}

export function lineEdits(before: string, after: string, ms: number = DIFF_MS): readonly LineEdit[] | null {
  const aligned = align(before, after, ms, Number.MAX_SAFE_INTEGER);
  return aligned === 'heavy' ? null : aligned.edits;
}

export function inlineEdits(before: string, after: string): Aligned {
  return before.length + after.length > INLINE_CHARS ? 'heavy' : align(before, after, DIFF_MS, INLINE_LINES);
}
