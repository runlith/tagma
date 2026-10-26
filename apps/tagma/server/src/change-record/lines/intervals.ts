import type { Change, Deadline } from '@runlith/utils/sequenceDiff';
import { lineIn, type TextSlice } from './text.js';
import { pairedMatches } from './alignment.js';
import { keyOf, locatedRuns, runAt, sizeOf, type LocatedRun, type Point, type Rope, type Run, type Source } from './marks.js';

export type Frame = {
  readonly root: Rope;
  readonly runs: readonly LocatedRun[];
  readonly count: number;
  readonly positions: ReadonlyMap<Source, readonly LocatedRun[]>;
};
export function frameOf(root: Rope): Frame {
  const runs = locatedRuns(root);
  const positions = new Map<Source, LocatedRun[]>();
  for (const run of runs) {
    const list = positions.get(run.source) ?? [];
    list.push(run);
    positions.set(run.source, list);
  }
  for (const list of positions.values()) list.sort((a, b) => a.offset - b.offset);
  return { root, runs, count: sizeOf(root), positions };
}

function offsetAt(runs: readonly LocatedRun[], offset: number): number {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const run = runs[mid] as LocatedRun;
    if (run.offset + run.count <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function indexOf(frame: Frame, point: Point): number | undefined {
  const runs = frame.positions.get(point.source);
  if (runs === undefined) return undefined;
  const run = runs[offsetAt(runs, point.offset)];
  return run !== undefined && point.offset >= run.offset && point.offset < run.offset + run.count
    ? run.at + point.offset - run.offset
    : undefined;
}

export function pointIn(frame: Frame, at: number): Point {
  const run = runAt(frame.runs, at);
  if (run === undefined) throw new Error('a line lies outside its frame');
  return { source: run.source, offset: run.offset + at - run.at };
}

export function anchorsOf(before: Frame, after: Frame): readonly Change[] {
  const anchors: Change[] = [];
  let past = 0;
  for (const run of after.runs) {
    const candidates = before.positions.get(run.source) ?? [];
    for (let i = offsetAt(candidates, run.offset); i < candidates.length; i += 1) {
      const candidate = candidates[i] as LocatedRun;
      if (candidate.offset >= run.offset + run.count) break;
      const start = Math.max(run.offset, candidate.offset);
      const end = Math.min(run.offset + run.count, candidate.offset + candidate.count);
      const from = candidate.at + start - candidate.offset;
      if (from < past) continue;
      const to = run.at + start - run.offset;
      anchors.push({ before: { start: from, end: from + end - start }, after: { start: to, end: to + end - start } });
      past = from + end - start;
    }
  }
  return anchors;
}

export function gapsOf(anchors: readonly Change[], before: number, after: number): readonly Change[] {
  const gaps: Change[] = [];
  let from = 0;
  let to = 0;
  for (const anchor of [...anchors, { before: { start: before, end: before }, after: { start: after, end: after } }]) {
    if (from !== anchor.before.start || to !== anchor.after.start)
      gaps.push({ before: { start: from, end: anchor.before.start }, after: { start: to, end: anchor.after.start } });
    from = anchor.before.end;
    to = anchor.after.end;
  }
  return gaps;
}

export function intersectAnchors(one: readonly Change[], two: readonly Change[]): readonly Change[] {
  const kept: Change[] = [];
  let at = 0;
  for (const a of one) {
    while (at < two.length && (two[at] as Change).before.end <= a.before.start) at += 1;
    for (let i = at; i < two.length; i += 1) {
      const b = two[i] as Change;
      if (b.before.start >= a.before.end) break;
      if (a.after.start - a.before.start !== b.after.start - b.before.start) continue;
      const start = Math.max(a.before.start, b.before.start);
      const end = Math.min(a.before.end, b.before.end);
      kept.push({
        before: { start, end },
        after: { start: start + a.after.start - a.before.start, end: end + a.after.start - a.before.start },
      });
    }
  }
  return kept;
}

export type WalkRun = {
  readonly at: number;
  readonly count: number;
  readonly source: number;
  readonly offset: number;
  readonly text: TextSlice;
};
export type WalkFrame = { readonly runs: readonly WalkRun[]; readonly count: number };
export const walkFrame = (frame: Frame): WalkFrame => ({
  count: frame.count,
  runs: frame.runs.map((run) => ({
    at: run.at,
    count: run.count,
    source: run.source.serial,
    offset: run.offset,
    text: run.source.shared,
  })),
});
export type Minimum = { readonly distance: number; readonly matches: readonly Change[] } | { readonly reason: 'budget' };

const keysOf = (frame: WalkFrame, normalized: boolean, ids: Map<string, number>): Int32Array => {
  const keys = new Int32Array(frame.count);
  for (const run of frame.runs)
    for (let at = 0; at < run.count; at += 1) {
      const key = keyOf(lineIn(run.text, run.offset + at), normalized);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      keys[run.at + at] = id;
    }
  return keys;
};

function walkRuns(before: WalkFrame, after: WalkFrame, normalized: boolean, budget: Deadline, cap: number): Minimum | 'long' {
  type Path = { readonly previous: Path | null; readonly match: Change };
  const reach = new Map<number, number>([[1, 0]]);
  const paths = new Map<number, Path | null>();
  let steps = 0;
  const spent = (): boolean => (steps += 1) > cap;
  for (let distance = 0; distance <= before.count + after.count; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (budget.expired(1)) return { reason: 'budget' };
      if (spent()) return 'long';
      const down = diagonal === -distance || (diagonal !== distance && (reach.get(diagonal - 1) ?? -1) < (reach.get(diagonal + 1) ?? -1));
      let x = down ? (reach.get(diagonal + 1) ?? 0) : (reach.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      const startX = x;
      const startY = y;
      while (x < before.count && y < after.count) {
        if (budget.expired(1)) return { reason: 'budget' };
        if (spent()) return 'long';
        const left = runAt(before.runs, x) as WalkRun;
        const right = runAt(after.runs, y) as WalkRun;
        const a = left.offset + x - left.at;
        const b = right.offset + y - right.at;
        if (left.source === right.source && a === b) {
          const length = Math.min(left.at + left.count - x, right.at + right.count - y);
          x += length;
          y += length;
        } else if (keyOf(lineIn(left.text, a), normalized) === keyOf(lineIn(right.text, b), normalized)) {
          x += 1;
          y += 1;
        } else break;
      }
      const previous = paths.get(down ? diagonal + 1 : diagonal - 1) ?? null;
      const path: Path | null =
        x === startX ? previous : { previous, match: { before: { start: startX, end: x }, after: { start: startY, end: y } } };
      reach.set(diagonal, x);
      paths.set(diagonal, path);
      if (x >= before.count && y >= after.count) {
        const matches: Change[] = [];
        for (let p = path; p !== null; p = p.previous) matches.push(p.match);
        return { distance, matches: matches.reverse() };
      }
    }
  }
  throw new Error('the shortest edit walk did not reach its end');
}

export function minimumOf(before: WalkFrame, after: WalkFrame, normalized: boolean, budget: Deadline): Minimum {
  const quick = walkRuns(before, after, normalized, budget, before.count + after.count);
  if (quick !== 'long') return quick;
  if (budget.expired(before.count + after.count)) return { reason: 'budget' };
  const ids = new Map<string, number>();
  const paired = pairedMatches(keysOf(before, normalized, ids), keysOf(after, normalized, ids), budget);
  if ('reason' in paired) return paired;
  const matches: Change[] = [];
  for (const { before: from, after: to } of paired) {
    const last = matches.at(-1);
    if (last !== undefined && last.before.end === from && last.after.end === to)
      matches[matches.length - 1] = {
        before: { start: last.before.start, end: from + 1 },
        after: { start: last.after.start, end: to + 1 },
      };
    else matches.push({ before: { start: from, end: from + 1 }, after: { start: to, end: to + 1 } });
  }
  return { distance: before.count + after.count - 2 * paired.length, matches };
}

export type MarkSpan = { readonly source: Source; readonly start: number; readonly end: number; readonly writer: Source };
export class RemovalIndex {
  private readonly spans = new Map<Source, readonly MarkSpan[]>();
  constructor(spans: readonly MarkSpan[]) {
    const groups = new Map<Source, MarkSpan[]>();
    for (const span of spans) {
      const group = groups.get(span.source) ?? [];
      group.push(span);
      groups.set(span.source, group);
    }
    for (const [source, group] of groups) {
      const events = group
        .flatMap((span) => [
          { at: span.start, span, add: true },
          { at: span.end, span, add: false },
        ])
        .sort((a, b) => a.at - b.at);
      const live = new Set<MarkSpan>();
      const heap: MarkSpan[] = [];
      const push = (span: MarkSpan): void => {
        heap.push(span);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >>> 1;
          if ((heap[p] as MarkSpan).writer.serial >= span.writer.serial) break;
          heap[i] = heap[p] as MarkSpan;
          i = p;
        }
        heap[i] = span;
      };
      const pop = (): void => {
        const last = heap.pop();
        if (last === undefined || heap.length === 0) return;
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && (heap[child + 1] as MarkSpan).writer.serial > (heap[child] as MarkSpan).writer.serial) child += 1;
          if ((heap[child] as MarkSpan).writer.serial <= last.writer.serial) break;
          heap[i] = heap[child] as MarkSpan;
          i = child;
        }
        heap[i] = last;
      };
      const resolved: MarkSpan[] = [];
      let previous = 0;
      for (let i = 0; i < events.length;) {
        const at = (events[i] as (typeof events)[number]).at;
        const winner = heap[0];
        if (winner !== undefined && previous < at) resolved.push({ source, start: previous, end: at, writer: winner.writer });
        while (i < events.length && events[i]?.at === at) {
          const event = events[i++] as (typeof events)[number];
          if (event.add) {
            live.add(event.span);
            push(event.span);
          } else live.delete(event.span);
        }
        while (heap[0] !== undefined && !live.has(heap[0])) pop();
        previous = at;
      }
      this.spans.set(source, resolved);
    }
  }
  writer(point: Point): Source | undefined {
    const spans = this.spans.get(point.source) ?? [];
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((spans[mid] as MarkSpan).start <= point.offset) low = mid + 1;
      else high = mid;
    }
    const span = spans[low - 1];
    return span !== undefined && point.offset < span.end ? span.writer : undefined;
  }
}

export const spanOf = (run: Run, writer: Source): MarkSpan => ({
  source: run.source,
  start: run.offset,
  end: run.offset + run.count,
  writer,
});
