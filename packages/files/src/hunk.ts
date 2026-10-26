export type LineHunk = {
  readonly firstLine: number;
  readonly oldLines: number;
  readonly newLines: number;
  readonly windowBefore: number;
  readonly oldText: string;
  readonly newText: string;
};

function lineOffsets(lines: readonly string[]): number[] {
  const offsets = [0];
  for (const line of lines) offsets.push((offsets[offsets.length - 1] as number) + line.length + 1);
  return offsets;
}

function standsTwice(lines: readonly string[], back: Int32Array, from: number, span: number, last: number): boolean {
  let seen = 0;
  for (let at = 1; at < span; at += 1) {
    while (seen > 0 && lines[from + at] !== lines[from + seen]) seen = back[seen - 1] as number;
    if (lines[from + at] === lines[from + seen]) seen += 1;
    back[at] = seen;
  }
  let found = 0;
  let held = 0;
  const end = last + span;
  for (let at = 0; at < end; at += 1) {
    while (held > 0 && lines[at] !== lines[from + held]) held = back[held - 1] as number;
    if (lines[at] === lines[from + held]) held += 1;
    if (held === span) {
      found += 1;
      if (found > 1) return true;
      held = back[span - 1] as number;
    }
  }
  return false;
}

type Side = {
  readonly lines: readonly string[];
  readonly back: Int32Array;
  readonly blank: boolean;
  readonly open: boolean;
  readonly end: number;
};

function sideOf(text: string, lines: readonly string[], end: number): Side {
  return {
    lines,
    back: new Int32Array(lines.length),
    blank: text === '',
    open: lines[lines.length - 1] !== '',
    end,
  };
}

function standsAlone(side: Side, start: number, end: number): boolean {
  const count = side.lines.length;
  const stop = end === count && !side.open ? count - 1 : end;
  if (stop <= start) return side.blank;
  if (stop === count) return true;
  const span = stop - start;
  return !standsTwice(side.lines, side.back, start, span, count - 1 - span);
}

function widening(before: string, from: readonly string[], after: string, to: readonly string[], head: number, tail: number): number {
  const steps = Math.max(head, tail);
  if (steps === 0) return 0;
  const older = sideOf(before, from, from.length - tail);
  const newer = sideOf(after, to, to.length - tail);
  const grown = narrowest(older, head, tail, steps);
  return grown === steps ? steps : Math.max(grown, narrowest(newer, head, tail, steps));
}

function narrowest(side: Side, head: number, tail: number, steps: number): number {
  const alone = (step: number) => standsAlone(side, head - Math.min(step, head), side.end + Math.min(step, tail));
  if (alone(0)) return 0;
  let low = 1;
  let high = 1;
  while (high < steps && !alone(high)) {
    low = high + 1;
    high = Math.min(high * 2, steps);
  }
  while (low < high) {
    const mid = (low + high) >> 1;
    if (alone(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

const unreturned = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

export function workspaceChangeHunk(before: string, after: string, normalized = false): LineHunk | undefined {
  if (before === after) return undefined;
  const real = { from: before.split('\n'), to: after.split('\n') };
  const from = normalized ? real.from.map(unreturned) : real.from;
  const to = normalized ? real.to.map(unreturned) : real.to;
  let head = 0;
  while (before !== '' && after !== '' && head < from.length && head < to.length && from[head] === to[head]) {
    head += 1;
  }
  if (head === from.length && head === to.length) return undefined;
  let tail = 0;
  while (tail < from.length - head && tail < to.length - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) {
    tail += 1;
  }
  const fromAt = lineOffsets(real.from);
  const toAt = lineOffsets(real.to);
  const grown = widening(before, from, after, to, head, tail);
  const start = head - Math.min(grown, head);
  const oldEnd = from.length - tail + Math.min(grown, tail);
  const newEnd = to.length - tail + Math.min(grown, tail);
  return {
    firstLine: head + 1,
    oldLines: before === '' ? 0 : Math.max(0, from.length - head - tail),
    newLines: after === '' ? 0 : Math.max(0, to.length - head - tail),
    windowBefore: head - start,
    oldText: before.slice(fromAt[start] as number, fromAt[oldEnd] as number),
    newText: after.slice(toAt[start] as number, toAt[newEnd] as number),
  };
}
