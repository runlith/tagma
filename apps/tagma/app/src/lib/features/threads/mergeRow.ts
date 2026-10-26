import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const theirs = right as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(theirs).length &&
    keys.every((key) => key in theirs && sameValue((left as Record<string, unknown>)[key], theirs[key]))
  );
}

export function mergeRow(held: ThreadListRow, row: ThreadListRow): ThreadListRow {
  const before = held as unknown as Record<string, unknown>;
  const after = row as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  let moved = Object.keys(before).some((key) => !(key in after));
  for (const key of Object.keys(after)) {
    const same = sameValue(before[key], after[key]);
    merged[key] = same ? before[key] : after[key];
    moved ||= !same;
  }
  return moved ? (merged as unknown as ThreadListRow) : held;
}
