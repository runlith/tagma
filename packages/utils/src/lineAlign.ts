import {
  type Alignment,
  type Change,
  type Deadline,
  type Sequence,
  OUTSIDE,
  joined,
  myersAlignment,
  optimized,
  scoredAlignment,
  spread,
} from './sequenceDiff.js';

const PATCH_SCORED_LINES = 1700;

const JOIN_UNCHANGED_CHARS = 4;

const JOIN_LONG_CHANGE = 5;

const JOIN_PASSES = 10;

export function alignLines(before: readonly string[], after: readonly string[], deadline: Deadline): Alignment {
  const hashes = new Map<string, number>();
  const hashOf = (line: string): number => {
    const known = hashes.get(line);
    if (known !== undefined) return known;
    const made = hashes.size;
    hashes.set(line, made);
    return made;
  };
  const one = lineSequence(
    before,
    before.map((line) => hashOf(line.trim())),
  );
  const two = lineSequence(
    after,
    after.map((line) => hashOf(line.trim())),
  );
  const aligned =
    one.length + two.length < PATCH_SCORED_LINES
      ? scoredAlignment(one, two, deadline, (offset1, offset2) => lineScore(before, after, offset1, offset2))
      : myersAlignment(one, two, deadline);
  return { changes: joinedOverThinLines(before, optimized(one, two, aligned.changes)), timedOut: aligned.timedOut };
}

function lineSequence(lines: readonly string[], hashes: readonly number[]): Sequence {
  return {
    length: hashes.length,
    element: (offset) => hashes[offset] ?? OUTSIDE,
    stronglyEqual: (offset1, offset2) => lines[offset1] === lines[offset2],
    boundaryScore: (offset) => 1000 - (indentOf(lines[offset - 1]) + indentOf(lines[offset])),
  };
}

function indentOf(line: string | undefined): number {
  if (line === undefined) return 0;
  let at = 0;
  while (at < line.length && (line[at] === ' ' || line[at] === '\t')) at += 1;
  return at;
}

function lineScore(before: readonly string[], after: readonly string[], offset1: number, offset2: number): number {
  const line = after[offset2] ?? '';
  if (before[offset1] !== line) return 0.99;
  return line.length === 0 ? 0.1 : 1 + Math.log(1 + line.length);
}

function joinedOverThinLines(before: readonly string[], changes: readonly Change[]): readonly Change[] {
  if (changes.length === 0) return changes;
  let current = changes;
  let passes = 0;
  let again = false;
  do {
    again = false;
    const result: Change[] = [current[0] as Change];
    for (let i = 1; i < current.length; i += 1) {
      const change = current[i] as Change;
      const last = result[result.length - 1] as Change;
      const between = before.slice(last.before.end, change.before.start).join('\n').replace(/\s/g, '');
      const long = spread(last) > JOIN_LONG_CHANGE || spread(change) > JOIN_LONG_CHANGE;
      if (between.length <= JOIN_UNCHANGED_CHARS && long) {
        again = true;
        result[result.length - 1] = joined(last, change);
        continue;
      }
      result.push(change);
    }
    current = result;
    passes += 1;
  } while (again && passes < JOIN_PASSES);
  return current;
}
