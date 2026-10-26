export type Span = { readonly start: number; readonly end: number };

export type Change = { readonly before: Span; readonly after: Span };

export type Alignment = { readonly changes: readonly Change[]; readonly timedOut: boolean };

export type Sequence = {
  readonly length: number;
  element(offset: number): number;
  stronglyEqual(offset1: number, offset2: number): boolean;
  boundaryScore(offset: number): number;
};

export type Deadline = { expired(work: number): boolean };

type Snake = { readonly prev: Snake | null; readonly x: number; readonly y: number; readonly length: number };

export const OUTSIDE = -1;

const DIAGONAL = 1;
const HORIZONTAL = 2;

const MAX_SHIFT = 100;

export function deadlineIn(ms: number): Deadline {
  const until = Date.now() + ms;
  let out = false;
  return { expired: () => (out ||= Date.now() > until) };
}

export function stepsIn(budget: number): Deadline {
  let left = budget;
  return { expired: (work) => (left -= work) < 0 };
}

export function scoredAlignment(
  before: Sequence,
  after: Sequence,
  deadline: Deadline,
  score?: (offset1: number, offset2: number) => number,
): Alignment {
  if (before.length === 0 || after.length === 0) return { changes: [whole(before, after)], timedOut: false };
  if (deadline.expired(0)) return { changes: [whole(before, after)], timedOut: true };
  const width = before.length;
  const height = after.length;
  const best = new Float64Array(width * height);
  const step = new Uint8Array(width * height);
  const run = new Int32Array(width * height);
  for (let s1 = 0; s1 < width; s1 += 1) {
    if (deadline.expired(height)) return { changes: [whole(before, after)], timedOut: true };
    for (let s2 = 0; s2 < height; s2 += 1) {
      const at = s1 + s2 * width;
      const horizontal = s1 === 0 ? 0 : (best[at - 1] as number);
      const vertical = s2 === 0 ? 0 : (best[at - width] as number);
      let diagonal = -1;
      if (before.element(s1) === after.element(s2)) {
        const back = at - width - 1;
        diagonal = s1 === 0 || s2 === 0 ? 0 : (best[back] as number);
        if (s1 > 0 && s2 > 0 && step[back] === DIAGONAL) diagonal += run[back] as number;
        diagonal += score ? score(s1, s2) : 1;
      }
      const value = Math.max(horizontal, vertical, diagonal);
      if (value === diagonal) {
        run[at] = (s1 > 0 && s2 > 0 ? (run[at - width - 1] as number) : 0) + 1;
        step[at] = DIAGONAL;
      } else if (value === horizontal) {
        run[at] = 0;
        step[at] = HORIZONTAL;
      } else {
        run[at] = 0;
      }
      best[at] = value;
    }
  }
  const changes: Change[] = [];
  let lastBefore = width;
  let lastAfter = height;
  const report = (s1: number, s2: number): void => {
    if (s1 + 1 !== lastBefore || s2 + 1 !== lastAfter) {
      changes.push({ before: { start: s1 + 1, end: lastBefore }, after: { start: s2 + 1, end: lastAfter } });
    }
    lastBefore = s1;
    lastAfter = s2;
  };
  let s1 = width - 1;
  let s2 = height - 1;
  while (s1 >= 0 && s2 >= 0) {
    const taken = step[s1 + s2 * width];
    if (taken === DIAGONAL) {
      report(s1, s2);
      s1 -= 1;
      s2 -= 1;
    } else if (taken === HORIZONTAL) {
      s1 -= 1;
    } else {
      s2 -= 1;
    }
  }
  report(-1, -1);
  changes.reverse();
  return { changes, timedOut: false };
}

export function myersAlignment(before: Sequence, after: Sequence, deadline: Deadline): Alignment {
  if (before.length === 0 || after.length === 0) return { changes: [whole(before, after)], timedOut: false };
  let work = 0;
  const xAfterSnake = (x: number, y: number): number => {
    let atX = x;
    let atY = y;
    while (atX < before.length && atY < after.length && before.element(atX) === after.element(atY)) {
      atX += 1;
      atY += 1;
    }
    work += atX - x + 1;
    return atX;
  };
  const offset = after.length + 2;
  const reach = new Int32Array(before.length + after.length + 5);
  const paths = new Array<Snake | null>(reach.length).fill(null);
  reach[offset] = xAfterSnake(0, 0);
  paths[offset] = reach[offset] === 0 ? null : { prev: null, x: 0, y: 0, length: reach[offset] as number };
  let d = 0;
  let k = 0;
  walk: for (;;) {
    d += 1;
    if (deadline.expired(work)) return { changes: [whole(before, after)], timedOut: true };
    work = 0;
    const lower = -Math.min(d, after.length + (d % 2));
    const upper = Math.min(d, before.length + (d % 2));
    for (k = lower; k <= upper; k += 2) {
      const at = k + offset;
      const fromTop = k === upper ? -1 : (reach[at + 1] as number);
      const fromLeft = k === lower ? -1 : (reach[at - 1] as number) + 1;
      const x = Math.min(Math.max(fromTop, fromLeft), before.length);
      const y = x - k;
      if (y > after.length) continue;
      const reached = xAfterSnake(x, y);
      reach[at] = reached;
      const last = x === fromTop ? (paths[at + 1] ?? null) : (paths[at - 1] ?? null);
      paths[at] = reached === x ? last : { prev: last, x, y, length: reached - x };
      if (reached === before.length && reached - k === after.length) break walk;
    }
  }
  deadline.expired(work);
  let path = paths[k + offset] ?? null;
  const changes: Change[] = [];
  let lastBefore = before.length;
  let lastAfter = after.length;
  for (;;) {
    const endBefore = path ? path.x + path.length : 0;
    const endAfter = path ? path.y + path.length : 0;
    if (endBefore !== lastBefore || endAfter !== lastAfter) {
      changes.push({ before: { start: endBefore, end: lastBefore }, after: { start: endAfter, end: lastAfter } });
    }
    if (!path) break;
    lastBefore = path.x;
    lastAfter = path.y;
    path = path.prev;
  }
  changes.reverse();
  return { changes, timedOut: false };
}

export function optimized(before: Sequence, after: Sequence, changes: readonly Change[]): readonly Change[] {
  return shiftedToBoundary(before, after, joinedByShifting(before, after, joinedByShifting(before, after, changes)));
}

function joinedByShifting(before: Sequence, after: Sequence, changes: readonly Change[]): readonly Change[] {
  if (changes.length === 0) return changes;
  const left: Change[] = [changes[0] as Change];
  for (let i = 1; i < changes.length; i += 1) {
    const previous = left[left.length - 1] as Change;
    let current = changes[i] as Change;
    if (empty(current.before) || empty(current.after)) {
      const length = current.before.start - previous.before.end;
      let back = 1;
      for (; back <= length; back += 1) {
        if (
          before.element(current.before.start - back) !== before.element(current.before.end - back) ||
          after.element(current.after.start - back) !== after.element(current.after.end - back)
        ) {
          break;
        }
      }
      back -= 1;
      if (back === length) {
        left[left.length - 1] = {
          before: { start: previous.before.start, end: current.before.end - length },
          after: { start: previous.after.start, end: current.after.end - length },
        };
        continue;
      }
      current = shifted(current, -back);
    }
    left.push(current);
  }
  const right: Change[] = [];
  for (let i = 0; i < left.length - 1; i += 1) {
    const next = left[i + 1] as Change;
    let current = left[i] as Change;
    if (empty(current.before) || empty(current.after)) {
      const length = next.before.start - current.before.end;
      let forward = 0;
      for (; forward < length; forward += 1) {
        if (
          !before.stronglyEqual(current.before.start + forward, current.before.end + forward) ||
          !after.stronglyEqual(current.after.start + forward, current.after.end + forward)
        ) {
          break;
        }
      }
      if (forward === length) {
        left[i + 1] = {
          before: { start: current.before.start + length, end: next.before.end },
          after: { start: current.after.start + length, end: next.after.end },
        };
        continue;
      }
      if (forward > 0) current = shifted(current, forward);
    }
    right.push(current);
  }
  if (left.length > 0) right.push(left[left.length - 1] as Change);
  return right;
}

function shiftedToBoundary(before: Sequence, after: Sequence, changes: readonly Change[]): readonly Change[] {
  const result = [...changes];
  for (let i = 0; i < result.length; i += 1) {
    const previous = i > 0 ? (result[i - 1] as Change) : undefined;
    const change = result[i] as Change;
    const next = i + 1 < result.length ? (result[i + 1] as Change) : undefined;
    const beforeRoom: Span = {
      start: previous ? previous.before.end + 1 : 0,
      end: next ? next.before.start - 1 : before.length,
    };
    const afterRoom: Span = {
      start: previous ? previous.after.end + 1 : 0,
      end: next ? next.after.start - 1 : after.length,
    };
    if (empty(change.before)) {
      result[i] = shiftedToBestScore(change, before, after, beforeRoom, afterRoom);
    } else if (empty(change.after)) {
      result[i] = swapped(shiftedToBestScore(swapped(change), after, before, afterRoom, beforeRoom));
    }
  }
  return result;
}

function shiftedToBestScore(change: Change, first: Sequence, second: Sequence, firstRoom: Span, secondRoom: Span): Change {
  let back = 1;
  while (
    change.before.start - back >= firstRoom.start &&
    change.after.start - back >= secondRoom.start &&
    second.stronglyEqual(change.after.start - back, change.after.end - back) &&
    back < MAX_SHIFT
  ) {
    back += 1;
  }
  back -= 1;
  let forward = 0;
  while (
    change.before.start + forward < firstRoom.end &&
    change.after.end + forward < secondRoom.end &&
    second.stronglyEqual(change.after.start + forward, change.after.end + forward) &&
    forward < MAX_SHIFT
  ) {
    forward += 1;
  }
  if (back === 0 && forward === 0) return change;
  let bestDelta = 0;
  let bestScore = -1;
  for (let delta = -back; delta <= forward; delta += 1) {
    const score =
      first.boundaryScore(change.before.start + delta) +
      second.boundaryScore(change.after.start + delta) +
      second.boundaryScore(change.after.end + delta);
    if (score > bestScore) {
      bestScore = score;
      bestDelta = delta;
    }
  }
  return shifted(change, bestDelta);
}

export function spread(change: Change): number {
  return change.before.end - change.before.start + (change.after.end - change.after.start);
}

export function empty(span: Span): boolean {
  return span.start === span.end;
}

function shifted(change: Change, delta: number): Change {
  if (delta === 0) return change;
  return {
    before: { start: change.before.start + delta, end: change.before.end + delta },
    after: { start: change.after.start + delta, end: change.after.end + delta },
  };
}

export function joined(one: Change, two: Change): Change {
  return {
    before: { start: Math.min(one.before.start, two.before.start), end: Math.max(one.before.end, two.before.end) },
    after: { start: Math.min(one.after.start, two.after.start), end: Math.max(one.after.end, two.after.end) },
  };
}

function swapped(change: Change): Change {
  return { before: change.after, after: change.before };
}

function whole(before: Sequence, after: Sequence): Change {
  return { before: { start: 0, end: before.length }, after: { start: 0, end: after.length } };
}
