import { alignWindow } from './alignment.js';
import { tokensOf } from './marks.js';

export type Overlay = { readonly base: string; readonly selected: string; readonly staged: string };

export const overlay = ({ base, selected, staged }: Overlay): string | null => {
  if (base === staged || selected === staged) return selected;
  if (base === selected) return staged;
  let remaining = 1 << 23;
  const budget = { expired: (amount: number) => (remaining -= amount) < 0 };
  const before = tokensOf(base);
  const own = tokensOf(selected);
  const index = tokensOf(staged);
  const chosen = alignWindow({ before, after: own, normalized: false }, budget);
  const incoming = alignWindow({ before, after: index, normalized: false }, budget);
  if ('reason' in chosen || 'reason' in incoming) return null;
  let at = 0;
  let shift = 0;
  const position = (point: number, end: boolean): number | null => {
    for (; at < incoming.changes.length; at += 1) {
      const change = incoming.changes[at]!;
      if (point < change.before.start) return point + shift;
      if (point > change.before.end) {
        shift = change.after.end - change.before.end;
        continue;
      }
      if (change.before.start === change.before.end) return end ? change.after.start : change.after.end;
      if (point === change.before.start) return change.after.start;
      if (point === change.before.end) return change.after.end;
      if (change.before.end - change.before.start === change.after.end - change.after.start)
        return change.after.start + point - change.before.start;
      return null;
    }
    return point + shift;
  };
  const output: string[] = [];
  let cursor = 0;
  for (const change of chosen.changes) {
    const start = position(change.before.start, false);
    const end = position(change.before.end, true);
    if (start === null || end === null || start < cursor || end < start) return null;
    output.push(index.slice(cursor, start).join(''), own.slice(change.after.start, change.after.end).join(''));
    cursor = end;
  }
  output.push(index.slice(cursor).join(''));
  return output.join('');
};
