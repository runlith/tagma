import { describe, expect, test } from 'bun:test';
import { windowMatches } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import type { LineHunk } from '@runlith/files/hunk';

function starts(text: string): number[] {
  const at = [0];
  for (const line of text.split('\n')) at.push((at[at.length - 1] as number) + line.length + 1);
  return at;
}

function shared(before: string, after: string) {
  const from = before.split('\n');
  const to = after.split('\n');
  let head = 0;
  while (before !== '' && after !== '' && head < from.length && head < to.length && from[head] === to[head]) head += 1;
  let tail = 0;
  while (tail < from.length - head && tail < to.length - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) {
    tail += 1;
  }
  return { from, to, head, tail, steps: Math.max(head, tail) };
}

function widened(before: string, after: string, step: number): { readonly old: string; readonly fresh: string } {
  const { from, to, head, tail } = shared(before, after);
  const fromAt = starts(before);
  const toAt = starts(after);
  const start = head - Math.min(step, head);
  return {
    old: before.slice(fromAt[start] as number, fromAt[from.length - tail + Math.min(step, tail)] as number),
    fresh: after.slice(toAt[start] as number, toAt[to.length - tail + Math.min(step, tail)] as number),
  };
}

function alone(before: string, after: string, step: number): boolean {
  const { old, fresh } = widened(before, after, step);
  return windowMatches(before, old).length === 1 && windowMatches(after, fresh).length === 1;
}

function stepOf(before: string, after: string, hunk: LineHunk): number {
  const { steps } = shared(before, after);
  for (let step = 0; step <= steps; step += 1) {
    const window = widened(before, after, step);
    if (window.old === hunk.oldText && window.fresh === hunk.newText) return step;
  }
  return -1;
}

function replayed(before: string, hunk: LineHunk): string {
  const found = windowMatches(before, hunk.oldText);
  const at = found[0] as number;
  return before.slice(0, at) + hunk.newText + before.slice(at + hunk.oldText.length);
}

const shapes: readonly (readonly [string, string])[] = [
  ['', 'one\n'],
  ['one\n', ''],
  ['one\ntwo\n', 'one\nTWO\n'],
  ['one\ntwo', 'one\nTWO'],
  ['a\na\na\na\na\n', 'a\na\nb\na\na\n'],
  ['a\na\n', 'a\na\na\n'],
  ['a\na\na\n', 'a\na\n'],
  ['x\ny\nx\ny\n', 'x\ny\nx\nz\n'],
  ['}\n}\n}\n}\n}\n}\n}\n', '}\n}\n}\nnew\n}\n}\n}\n}\n'],
  ['head\nsame\ntail\n', 'head\nsame\nSAME\ntail\n'],
  ['only', 'only\n'],
  ['a\n', 'b'],
  ['\n\n\n\n', '\n\n\n\n\n'],
];

function rolled(seed: number): () => number {
  let held = seed;
  return () => {
    held = (held + 0x6d2b79f5) | 0;
    let mixed = Math.imul(held ^ (held >>> 15), 1 | held);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function corpus(): readonly (readonly [string, string])[] {
  const roll = rolled(20260926);
  const words = ['a', 'b', 'c', '}', '', '  return;', 'a'];
  const pairs: (readonly [string, string])[] = [];
  while (pairs.length < 400) {
    const count = 1 + Math.floor(roll() * 12);
    const lines = Array.from({ length: count }, () => words[Math.floor(roll() * words.length)] as string);
    const before = lines.join('\n') + (roll() < 0.8 ? '\n' : '');
    const moved = [...lines];
    const act = Math.floor(roll() * 4);
    const at = Math.floor(roll() * moved.length);
    if (act === 0) moved[at] = words[Math.floor(roll() * words.length)] as string;
    if (act === 1) moved.splice(at, 0, words[Math.floor(roll() * words.length)] as string);
    if (act === 2) moved.splice(at, 1);
    if (act === 3) moved.push(words[Math.floor(roll() * words.length)] as string);
    const after = moved.join('\n') + (roll() < 0.8 ? '\n' : '');
    if (before !== after) pairs.push([before, after]);
  }
  return pairs;
}

describe('the window a hunk carries', () => {
  test('each side stands once in its own text, and no narrower window does', () => {
    const broken: unknown[] = [];
    for (const [before, after] of [...shapes, ...corpus()]) {
      const found = workspaceChangeHunk(before, after) as LineHunk;
      const step = stepOf(before, after, found);
      const { steps } = shared(before, after);
      const why =
        found === undefined
          ? 'no hunk'
          : step < 0
            ? 'the window is none the widening reaches'
            : !alone(before, after, step) && step < steps
              ? 'the window stands more than once'
              : step > 0 && alone(before, after, step - 1)
                ? 'a narrower window stands alone'
                : replayed(before, found) !== after
                  ? 'replaying the window does not give the later text'
                  : null;
      if (why !== null) broken.push({ before, after, why, hunk: found });
    }
    expect(broken).toEqual([]);
  });

  test('a file whose every line repeats widens to the whole file, since nothing narrower stands alone', () => {
    const before = 'a\na\na\na\n';
    const hunk = workspaceChangeHunk(before, 'a\na\na\na\na\n') as LineHunk;
    expect(hunk.oldText).toBe(before);
    expect(hunk.newText).toBe('a\na\na\na\na\n');
    expect(hunk.firstLine).toBe(5);
    expect(hunk.newLines).toBe(1);
  });

  test('a repeated line beside distinct neighbours widens only until those neighbours are in', () => {
    const hunk = workspaceChangeHunk('one\nx\ntwo\nx\nthree\n', 'one\nx\ntwo\nY\nthree\n') as LineHunk;
    expect(hunk.oldText).toBe('two\nx\nthree\n');
    expect(hunk.newText).toBe('two\nY\nthree\n');
    expect(hunk.firstLine).toBe(4);
    expect(hunk.newLines).toBe(1);
  });

  test('a file whose lines all repeat is read a few times over, not once per widening step', () => {
    const line = 'x'.repeat(19);
    const lines = Array.from({ length: 1000 }, () => line);
    const before = `${lines.join('\n')}\n`;
    const after = `${[...lines.slice(0, 500), 'changed', ...lines.slice(501)].join('\n')}\n`;
    const opened = performance.now();
    for (let at = 0; at < 100; at += 1) workspaceChangeHunk(before, after);
    expect(performance.now() - opened).toBeLessThan(2000);
  });
});
