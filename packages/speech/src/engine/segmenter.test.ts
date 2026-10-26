import { expect, test } from 'bun:test';
import { type Cut, feed, flush, quiet, type Segmenter, type SegmenterState } from './segmenter.ts';

const segmenter: Segmenter = {
  rate: 1000,
  window: 10,
  settings: { start: 0.5, end: 0.35, minSpeechMs: 50, minSilenceMs: 100, preRollMs: 30, maxMs: 300 },
};

const windows = (ms: number, probability: number) => Array.from({ length: ms / 10 }, () => probability);

const run = (state: SegmenterState, at: number, scenario: ReadonlyArray<number>) => {
  const [next, cuts] = feed(segmenter, state, at, scenario);
  return { next, cuts, at: at + scenario.length * segmenter.window };
};

test('a short reply over the minimum and the tail at the end of the track are cut, a blip is not', () => {
  const scenario = [
    ...windows(200, 0.05),
    ...windows(30, 0.9),
    ...windows(200, 0.05),
    ...windows(60, 0.9),
    ...windows(200, 0.1),
    ...windows(100, 0.8),
  ];
  const fed = run(quiet(0), 0, scenario);
  const [, tail] = flush(fed.next, fed.at);
  expect([...fed.cuts, ...tail]).toEqual<Array<Cut>>([
    { from: 400, to: 490, cause: 'silence' },
    { from: 660, to: 790, cause: 'flush' },
  ]);
});

test('speech past the limit is cut at its last quiet window, else at the limit', () => {
  const scenario = [...windows(250, 0.9), 0.2, ...windows(450, 0.9)];
  const fed = run(quiet(0), 0, scenario);
  const [, tail] = flush(fed.next, fed.at);
  expect([...fed.cuts, ...tail]).toEqual<Array<Cut>>([
    { from: 0, to: 250, cause: 'limit' },
    { from: 250, to: 550, cause: 'limit' },
    { from: 550, to: 710, cause: 'flush' },
  ]);
});

test('windows from before a reset that arrive late start no speech', () => {
  const late = run(quiet(400), 300, [...windows(100, 0.9)]);
  expect([late.next.phase, late.cuts]).toEqual(['quiet', []]);
});

test('a gap flushes the open speech and the next pre-roll does not reach back across it', () => {
  const before = run(quiet(0), 0, [...windows(100, 0.05), ...windows(100, 0.9)]);
  const [afterGap, atGap] = flush(before.next, before.at);
  const after = run(afterGap, before.at, [...windows(10, 0.05), ...windows(100, 0.9), ...windows(150, 0.05)]);
  expect([...atGap, ...after.cuts]).toEqual<Array<Cut>>([
    { from: 70, to: 200, cause: 'flush' },
    { from: 200, to: 310, cause: 'silence' },
  ]);
});
