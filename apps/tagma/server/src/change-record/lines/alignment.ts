import { myersAlignment, OUTSIDE, type Change, type Deadline, type Sequence } from '@runlith/utils/sequenceDiff';
import { keyOf } from './marks.js';

export type Match = { readonly before: number; readonly after: number };
export type Window = { readonly before: readonly string[]; readonly after: readonly string[]; readonly normalized: boolean };
export type Aligned = { readonly changes: readonly Change[] } | { readonly reason: 'budget' };

const sequence = (ids: readonly number[]): Sequence => ({
  length: ids.length,
  element: (at) => ids[at] ?? OUTSIDE,
  stronglyEqual: (a, b) => ids[a] === ids[b],
  boundaryScore: () => 0,
});

function changesOf(matches: readonly Match[], before: number, after: number): readonly Change[] {
  const changes: Change[] = [];
  let from = 0;
  let to = 0;
  for (const match of [...matches, { before, after }]) {
    if (from !== match.before || to !== match.after)
      changes.push({ before: { start: from, end: match.before }, after: { start: to, end: match.after } });
    from = match.before + 1;
    to = match.after + 1;
  }
  return changes;
}

function increasing(matches: readonly Match[]): readonly Match[] {
  const ends: number[] = [];
  const paths: number[] = [];
  const previous = new Int32Array(matches.length).fill(-1);
  for (let at = 0; at < matches.length; at += 1) {
    const value = (matches[at] as Match).after;
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((ends[mid] as number) < value) low = mid + 1;
      else high = mid;
    }
    ends[low] = value;
    previous[at] = low === 0 ? -1 : (paths[low - 1] as number);
    paths[low] = at;
  }
  const found: Match[] = [];
  for (let at = paths[paths.length - 1] ?? -1; at >= 0; at = previous[at] as number) found.push(matches[at] as Match);
  return found.reverse();
}

function uniqueMatches(before: readonly string[], after: readonly string[]): readonly Match[] {
  const one = new Map<string, number>();
  const two = new Map<string, number>();
  for (const [at, text] of before.entries()) one.set(text, one.has(text) ? -1 : at);
  for (const [at, text] of after.entries()) two.set(text, two.has(text) ? -1 : at);
  const matches: Match[] = [];
  for (const [text, at] of one) {
    const other = two.get(text);
    if (at >= 0 && other !== undefined && other >= 0) matches.push({ before: at, after: other });
  }
  return increasing(matches);
}

export function anchorWindows(
  window: Window,
  budget: Deadline,
):
  | { readonly before: readonly string[]; readonly after: readonly string[]; readonly gaps: readonly Change[] }
  | { readonly reason: 'budget' } {
  const before = window.before.map((line) => keyOf(line, window.normalized));
  const after = window.after.map((line) => keyOf(line, window.normalized));
  if (budget.expired(before.length + after.length)) return { reason: 'budget' };
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail += 1;
  if (head === before.length && head === after.length) return { before, after, gaps: [] };
  const older = before.slice(head, before.length - tail);
  const newer = after.slice(head, after.length - tail);
  const anchors = uniqueMatches(older, newer);
  return {
    before,
    after,
    gaps: changesOf(anchors, older.length, newer.length).map((gap) => ({
      before: { start: head + gap.before.start, end: head + gap.before.end },
      after: { start: head + gap.after.start, end: head + gap.after.end },
    })),
  };
}

function gapAlignment(left: readonly number[], right: readonly number[], budget: Deadline): Aligned {
  const cap = left.length + right.length;
  let steps = 0;
  let starved = false;
  const capped: Deadline = {
    expired: (work) => {
      if (budget.expired(work)) starved = true;
      return starved || (steps += work) > cap;
    },
  };
  const plain = myersAlignment(sequence(left), sequence(right), capped);
  if (starved) return { reason: 'budget' };
  if (!plain.timedOut) return plain;
  if (budget.expired(cap)) return { reason: 'budget' };
  const matches = pairedMatches(left, right, budget);
  return 'reason' in matches ? matches : { changes: changesOf(matches, left.length, right.length) };
}

export function pairedMatches(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  budget: Deadline,
): readonly Match[] | { readonly reason: 'budget' } {
  const kept = (ids: ArrayLike<number>, other: ArrayLike<number>): readonly number[] => {
    const present = new Set(Array.from(other));
    const at: number[] = [];
    for (let index = 0; index < ids.length; index += 1) if (present.has(ids[index] as number)) at.push(index);
    return at;
  };
  const xs = kept(left, right);
  const ys = kept(right, left);
  const narrowed = myersAlignment(sequence(xs.map((at) => left[at] as number)), sequence(ys.map((at) => right[at] as number)), budget);
  if (narrowed.timedOut || budget.expired(0)) return { reason: 'budget' };
  const matches: Match[] = [];
  for (const run of matchedRuns(narrowed.changes, xs.length, ys.length))
    for (let at = 0; at < run.before.end - run.before.start; at += 1)
      matches.push({ before: xs[run.before.start + at] as number, after: ys[run.after.start + at] as number });
  return matches;
}

export function alignWindow(window: Window, budget: Deadline): Aligned {
  const anchored = anchorWindows(window, budget);
  if ('reason' in anchored) return anchored;
  const { before, after, gaps } = anchored;
  const changes: Change[] = [];
  const ids = new Map<string, number>();
  const intern = (text: string): number => {
    const known = ids.get(text);
    if (known !== undefined) return known;
    const id = ids.size;
    ids.set(text, id);
    return id;
  };
  for (const gap of gaps) {
    const left = before.slice(gap.before.start, gap.before.end).map(intern);
    const right = after.slice(gap.after.start, gap.after.end).map(intern);
    const aligned = gapAlignment(left, right, budget);
    if ('reason' in aligned) return aligned;
    for (const change of aligned.changes) {
      if (change.before.start === change.before.end && change.after.start === change.after.end) continue;
      changes.push({
        before: { start: gap.before.start + change.before.start, end: gap.before.start + change.before.end },
        after: { start: gap.after.start + change.after.start, end: gap.after.start + change.after.end },
      });
    }
  }
  return { changes };
}

export type Canceled = { readonly changes: readonly Change[]; readonly matches: readonly Match[] } | { readonly reason: 'budget' };
export function cancelWindow(window: Window, budget: Deadline, preferred: readonly Match[] = []): Canceled {
  const before = window.before.map((line) => keyOf(line, window.normalized));
  const after = window.after.map((line) => keyOf(line, window.normalized));
  if (budget.expired(before.length + after.length)) return { reason: 'budget' };
  let head = 0;
  while (preferred.length === 0 && head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    preferred.length === 0 &&
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const positions = new Map<string, number[]>();
  for (let at = head; at < before.length - tail; at += 1) {
    const text = before[at] as string;
    const list = positions.get(text) ?? [];
    list.push(at);
    positions.set(text, list);
  }
  type Link = { readonly match: Match; readonly previous: Link | null; readonly length: number; readonly anchors: number };
  const anchors = new Map(preferred.map((match) => [match.after, match.before]));
  const paths: (Link | undefined)[] = Array.from({ length: before.length + 1 });
  const better = (one: Link, two: Link | undefined | null): boolean =>
    two == null || one.length > two.length || (one.length === two.length && one.anchors > two.anchors);
  const query = (end: number): Link | null => {
    let best: Link | null = null;
    for (let i = end; i > 0; i -= i & -i) {
      const candidate = paths[i];
      if (candidate !== undefined && better(candidate, best)) best = candidate;
    }
    return best;
  };
  for (let at = head; at < after.length - tail; at += 1) {
    const candidates = positions.get(after[at] as string) ?? [];
    if (budget.expired(candidates.length * (1 + Math.ceil(Math.log2(before.length + 1))))) return { reason: 'budget' };
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const value = candidates[i] as number;
      const previous = query(value);
      const link: Link = {
        match: { before: value, after: at },
        previous,
        length: (previous?.length ?? 0) + 1,
        anchors: (previous?.anchors ?? 0) + (anchors.get(at) === value ? 1 : 0),
      };
      for (let j = value + 1; j < paths.length; j += j & -j) if (better(link, paths[j])) paths[j] = link;
    }
  }
  const middle: Match[] = [];
  for (let link = query(before.length); link !== null; link = link.previous) middle.push(link.match);
  const matches: Match[] = [];
  for (let at = 0; at < head; at += 1) matches.push({ before: at, after: at });
  matches.push(...middle.reverse());
  for (let at = tail; at > 0; at -= 1) matches.push({ before: before.length - at, after: after.length - at });
  return { changes: changesOf(matches, before.length, after.length), matches };
}

export function matchedRuns(changes: readonly Change[], before: number, after: number): readonly Change[] {
  const runs: Change[] = [];
  let from = 0;
  let to = 0;
  for (const change of [...changes, { before: { start: before, end: before }, after: { start: after, end: after } }]) {
    if (from < change.before.start)
      runs.push({ before: { start: from, end: change.before.start }, after: { start: to, end: change.after.start } });
    from = change.before.end;
    to = change.after.end;
  }
  return runs;
}
