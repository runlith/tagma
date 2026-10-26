import type { Change, Deadline } from '@runlith/utils/sequenceDiff';
import { cancelWindow, type Match } from './alignment.js';
import { gapsOf, intersectAnchors, minimumOf, type WalkFrame } from './intervals.js';
import { keyOf } from './marks.js';
import { lineIn, sliceLines, sliceText, type TextSlice } from './text.js';
import type { Unknown } from './folding.js';

export type NetWindow = { readonly gap: Change; readonly changes: readonly Change[]; readonly matches: readonly Match[] };
export type NetWork = {
  readonly head: WalkFrame;
  readonly work: WalkFrame;
  readonly before: TextSlice;
  readonly after: TextSlice;
  readonly anchors: readonly Change[];
  readonly normalized: boolean;
};
const cost = (changes: readonly Change[]): number =>
  changes.reduce((sum, change) => sum + change.before.end - change.before.start + change.after.end - change.after.start, 0);

function cancel(gap: Change, work: NetWork, anchors: readonly Change[], budget: Deadline): NetWindow | Unknown {
  const preferred: Match[] = [];
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((anchors[mid] as Change).before.end <= gap.before.start) low = mid + 1;
    else high = mid;
  }
  for (let index = low; index < anchors.length; index += 1) {
    const anchor = anchors[index] as Change;
    if (anchor.before.start >= gap.before.end) break;
    const start = Math.max(gap.before.start, anchor.before.start);
    const end = Math.min(gap.before.end, anchor.before.end);
    for (let at = start; at < end; at += 1)
      preferred.push({ before: at - gap.before.start, after: anchor.after.start + at - anchor.before.start - gap.after.start });
  }
  const result = cancelWindow(
    {
      before: sliceLines(sliceText(work.before, gap.before.start, gap.before.end)),
      after: sliceLines(sliceText(work.after, gap.after.start, gap.after.end)),
      normalized: work.normalized,
    },
    budget,
    preferred,
  );
  if ('reason' in result) return result;
  return {
    gap,
    changes: result.changes.map((change) => ({
      before: { start: gap.before.start + change.before.start, end: gap.before.start + change.before.end },
      after: { start: gap.after.start + change.after.start, end: gap.after.start + change.after.end },
    })),
    matches: result.matches.map((match) => ({ before: gap.before.start + match.before, after: gap.after.start + match.after })),
  };
}

export function netOf(work: NetWork, budget: Deadline): readonly NetWindow[] | Unknown {
  const { anchors, head, work: frontier, before, after, normalized } = work;
  const hard: NetWindow[] = [];
  for (const gap of gapsOf(anchors, head.count, frontier.count)) {
    const window = cancel(gap, work, [], budget);
    if ('reason' in window) return window;
    hard.push(window);
  }
  const total = hard.reduce((sum, window) => sum + cost(window.changes), 0);
  if (budget.expired(total)) return { reason: 'budget' };
  const balance = new Map<string, number>();
  for (const window of hard)
    for (const change of window.changes) {
      for (let at = change.before.start; at < change.before.end; at += 1) {
        const key = keyOf(lineIn(before, at), normalized);
        balance.set(key, (balance.get(key) ?? 0) - 1);
      }
      for (let at = change.after.start; at < change.after.end; at += 1) {
        const key = keyOf(lineIn(after, at), normalized);
        balance.set(key, (balance.get(key) ?? 0) + 1);
      }
    }
  if ([...balance.values()].reduce((sum, count) => sum + Math.abs(count), 0) === total) return hard;
  const minimum = minimumOf(head, frontier, normalized, budget);
  if ('reason' in minimum) return minimum;
  if (total === minimum.distance) return hard;
  const fixed = intersectAnchors(anchors, minimum.matches);
  const windows: NetWindow[] = [];
  let cursor = 0;
  for (const gap of gapsOf(fixed, head.count, frontier.count)) {
    const inside: NetWindow[] = [];
    while (
      cursor < hard.length &&
      (hard[cursor] as NetWindow).gap.before.start <= gap.before.end &&
      (hard[cursor] as NetWindow).gap.after.start <= gap.after.end
    )
      inside.push(hard[cursor++] as NetWindow);
    const pairs = minimum.matches.reduce(
      (sum, match) => sum + Math.max(0, Math.min(gap.before.end, match.before.end) - Math.max(gap.before.start, match.before.start)),
      0,
    );
    const distance = gap.before.end - gap.before.start + gap.after.end - gap.after.start - 2 * pairs;
    if (distance >= inside.reduce((sum, window) => sum + cost(window.changes), 0)) windows.push(...inside);
    else {
      const window = cancel(gap, work, anchors, budget);
      if ('reason' in window) return window;
      windows.push(window);
    }
  }
  if (windows.reduce((sum, window) => sum + cost(window.changes), 0) !== minimum.distance)
    return { reason: 'opaque', cause: 'The recorded line alignment disagrees with the minimum diff', side: 'projection' };
  return windows;
}
