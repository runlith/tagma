import { expect, test } from 'bun:test';
import { controlEnvelope, displacement } from './displacement';
import type { Drag, Frame, Navigation, Recording, Rect, RowRect, RowSignature, WheelRun } from './recording';

const box = (top: number, height = 80, width = 200): Rect => ({ top, bottom: top + height, left: 0, right: width, width, height });
const signature = (): RowSignature => ({ text: 1, structure: 1, images: [], anchors: [], expanded: [], font: 'test', fonts: 'loaded' });
const row = (key: string, rect: Rect): RowRect => ({ key, rect, signature: signature(), live: false });
const frame = (time: number, top: number, patch: Partial<Frame> = {}): Frame => {
  const rows = patch.rows ?? [row('a', box(top, 100)), row('b', box(top + 100, 100))];
  return {
    time,
    sampled: time,
    dpr: 1,
    scrollTop: 1000 - (top - 100),
    scrollHeight: 10000,
    viewport: box(0, 1000, 500),
    rows,
    sentinels: [
      { id: 1, row: 'a', rect: box(top + 10, 10, 10), text: 'a' },
      { id: 2, row: 'b', rect: box(top + 110, 10, 10), text: 'b' },
    ],
    blank: 0,
    rail: true,
    tiles: 0,
    gold: null,
    geometry: null,
    line: 0,
    selected: null,
    mutation: 0,
    sizeChanges: 0,
    unmeasured: 0,
    moving: false,
    touching: false,
    finger: null,
    structure: false,
    control: null,
    controlRow: null,
    controlExpanded: null,
    controlAnimating: false,
    anchor: rows.length === 0 ? null : { kind: 'paused', row: rows[0]!.key, rect: rows[0]!.rect },
    changes: [],
    mounts: [],
    ...patch,
  };
};
const recording = (name: string, frames: Frame[]): Recording => ({ name, frames, touches: [], drags: [], wheels: [] });
const controls = (tops = [100, 120, 130, 135]): Recording[] =>
  Array.from({ length: 5 }, (_, control) =>
    recording(
      `control-${control}`,
      tops.map((top, index) => frame(index * 10, top, { moving: true })),
    ),
  );

test('quiet structural corrections keep stable rows still and accumulate subpixel drift', () => {
  const first = frame(0, 100);
  const second = frame(10, 100.3, { structure: true, scrollTop: 1600, sizeChanges: 1 });
  second.rows[1]!.rect = box(250, 120);
  second.sentinels[1]!.rect = box(270, 10, 10);
  const third = frame(20, 100.6, { structure: true, scrollTop: 1900 });
  third.rows[1]!.rect = box(300, 120);
  third.sentinels[1]!.rect = box(310, 10, 10);
  third.sentinels[1]!.text = 'changed text';
  third.rows[1]!.signature.text = 2;
  const result = displacement(recording('quiet', [first, second, third]));
  expect(result.comparisons).toBe(2);
  expect(result.pairs.map((pair) => pair.changedRows)).toEqual([['b'], ['b']]);
  expect(
    result.failures.filter((failure) => failure.sentinel !== null).map(({ kind, frame, sentinel }) => ({ kind, frame, sentinel })),
  ).toEqual([{ kind: 'cumulative', frame: 2, sentinel: 1 }]);
  expect(result.cumulativeDrift).toBeCloseTo(0.6);
  expect(result.unchecked).toEqual([]);
  const rebased = displacement(recording('rebase', [frame(0, 100), frame(10, 100, { scrollTop: 9000, structure: true })]));
  expect(rebased.comparisons).toBe(2);
  expect(rebased.maxError).toBe(0);
  expect(rebased.failures).toEqual([]);
});

test('a resized single row retains its unchanged text anchor while excluding reflowed paragraphs', () => {
  const first = frame(0, 100, {
    rows: [row('a', box(100, 600, 200))],
    sentinels: [
      { id: 1, row: 'a', rect: box(110, 10, 10), text: 'heading' },
      { id: 2, row: 'a', rect: box(300, 10, 10), text: 'paragraph' },
    ],
  });
  const resized = frame(10, 100, {
    structure: true,
    sizeChanges: 1,
    rows: [row('a', box(100, 800, 100))],
    sentinels: [
      { id: 1, row: 'a', rect: box(110, 10, 10), text: 'heading' },
      { id: 2, row: 'a', rect: box(340, 10, 10), text: 'paragraph' },
    ],
  });
  const stable = displacement(recording('resized', [first, resized]));
  expect(stable.comparisons).toBe(1);
  expect(stable.pairs[0]!.excluded).toBe(1);
  expect(stable.failures).toEqual([]);
  expect(stable.unchecked).toEqual([]);
  resized.rows[0]!.rect = box(105, 800, 100);
  resized.anchor = { kind: 'paused', row: 'a', rect: resized.rows[0]!.rect };
  resized.sentinels[0]!.rect = box(115, 10, 10);
  resized.sentinels[1]!.rect = box(345, 10, 10);
  const pulled = displacement(recording('pulled-anchor', [first, resized]));
  expect(pulled.comparisons).toBe(1);
  expect(pulled.failures.find((failure) => failure.kind === 'quiet')).toEqual({
    kind: 'quiet',
    frame: 1,
    sentinel: 1,
    pixels: 5,
    limit: 0.5,
  });
});

test('ordinary movement follows browser scroll delta and ignores sentinels outside either viewport', () => {
  const first = frame(0, 100, { moving: true });
  first.sentinels[1]!.rect = box(1100, 10, 10);
  const second = frame(10, 80, { moving: true });
  const third = frame(20, 60, { moving: true, scrollTop: 1050 });
  const result = displacement(recording('scroll', [first, second, third]));
  expect(result.pairs.map((pair) => pair.comparisons)).toEqual([1, 2]);
  expect(result.failures.map(({ kind, frame, pixels }) => ({ kind, frame, pixels }))).toEqual([
    { kind: 'scroll', frame: 2, pixels: 10 },
    { kind: 'scroll', frame: 2, pixels: 10 },
  ]);
});

test('device-pixel scroll agreement cannot substitute for common rigidity', () => {
  const before = frame(0, 100, { moving: true });
  const after = frame(10, 110, { moving: true });
  after.sentinels = after.sentinels.map((sentinel, index) => ({
    ...sentinel,
    rect: box(sentinel.rect.top + (index === 0 ? -1 : 1), 10, 10),
  }));
  const divergent = recording('nonrigid', [before, after]);
  expect(displacement(divergent).failures).toEqual([
    { kind: 'common', frame: 1, sentinel: 1, pixels: 1, limit: 0.5 },
    { kind: 'common', frame: 1, sentinel: 2, pixels: 1, limit: 0.5 },
  ]);
});

test('structural drag motion uses its own observed nonstructural rate, not nominal speed or touch points', () => {
  const first = frame(0, 100, { moving: true, touching: true, finger: 300 });
  const reference = frame(7.4, 105, { moving: true, touching: true, finger: 600 });
  const second = frame(17.4, 110, { moving: true, touching: true, finger: 900, structure: true, scrollTop: 1500 });
  const drag = { distance: 10, speed: 240, fromFrame: 0, toFrame: 2, preventFling: true };
  const clean = displacement({ ...recording('drag', [first, reference, second]), drags: [drag] });
  expect(clean.failures).toEqual([]);
  expect(clean.unchecked).toEqual([]);
  expect(clean.drags[0]!.observedRate).toBeCloseTo(5 / 7.4);
  expect(clean.drags[0]!.anchors.map((anchor) => anchor.distance)).toEqual([10, 10]);
  const split = frame(17.4, 110, { moving: true, touching: true, structure: true });
  split.sentinels[1]!.rect = box(222, 10, 10);
  const divergent = displacement({ ...recording('split', [first, reference, split]), drags: [drag] });
  expect(divergent.failures.filter((failure) => failure.kind === 'common').length).toBe(2);
  const pulled = displacement({
    ...recording('pulled', [first, reference, frame(17.4, 120, { moving: true, touching: true, structure: true })]),
    drags: [drag],
  });
  expect(pulled.failures.filter((failure) => failure.kind === 'drag-distance')).toEqual([
    { kind: 'drag-distance', frame: 2, sentinel: 1, pixels: 10, limit: 1 },
    { kind: 'drag-distance', frame: 2, sentinel: 2, pixels: 10, limit: 1 },
  ]);
  const unknown = displacement(recording('unknown-drag', [first, reference, second]));
  expect(unknown.unchecked).toEqual([
    { frame: 1, reason: 'no-known-drag' },
    { frame: 2, reason: 'no-known-drag' },
  ]);
  const unreferenced = displacement({ ...recording('no-reference', [first, second]), drags: [{ ...drag, distance: 10, toFrame: 1 }] });
  expect(unreferenced.unchecked).toEqual([{ frame: 1, reason: 'no-drag-rate' }]);
});

test('a fling uses browser rigidity and calibrated changes instead of its nominal input speed', () => {
  const frames = [
    frame(0, 100, { moving: true, touching: true }),
    frame(10, 120, { moving: true, touching: true }),
    frame(20, 130, { moving: true, structure: true, scrollTop: 2000 }),
    frame(30, 135, { moving: true, scrollTop: 1995 }),
  ];
  const result = displacement(
    { ...recording('fling', frames), drags: [{ distance: 20, speed: 1900, fromFrame: 0, toFrame: 1, preventFling: false }] },
    controlEnvelope(controls()),
  );
  expect(result.failures).toEqual([]);
  expect(result.unchecked).toEqual([]);
  expect(result.pairs.map((pair) => pair.mode)).toEqual(['scroll', 'momentum', 'scroll']);
  expect(result.pairs[1]!.controls).toBe(5);
});

test('a no-fling drag checks full-span distance and bounds each actual frame interval', () => {
  const frames = [frame(0, 100), frame(10, 105), frame(30, 115, { structure: true, scrollTop: 2000 }), frame(60, 130, { scrollTop: 1985 })];
  const drag = { distance: 30, speed: 500, fromFrame: 0, toFrame: 3, preventFling: true };
  const clean = displacement({ ...recording('known-path', frames), drags: [drag] });
  expect(clean.failures).toEqual([]);
  expect(clean.unchecked).toEqual([]);
  expect(clean.drags[0]!.complete).toBe(true);
  expect(clean.drags[0]!.anchors.map((anchor) => anchor.distance)).toEqual([30, 30]);
  const short = displacement({ ...recording('short-path', frames), drags: [{ ...drag, distance: 32 }] });
  expect(short.failures.filter((failure) => failure.kind === 'drag-distance').map((failure) => failure.pixels)).toEqual([2, 2]);
  const jump = displacement({
    ...recording('jump', [frame(0, 100), frame(10, 110), frame(20, 130, { structure: true })]),
    drags: [{ ...drag, speed: 1000, toFrame: 2 }],
  });
  expect(jump.failures.filter((failure) => failure.kind === 'drag-step').map((failure) => failure.pixels)).toEqual([10]);
  expect(jump.failures.filter((failure) => failure.kind === 'drag-distance')).toEqual([]);
  const identities = [
    [1, 2],
    [1, 12],
    [11, 12],
    [11, 22],
  ];
  const handoff = frames.map((one, index) => ({
    ...one,
    sentinels: one.sentinels.map((sentinel, at) => ({ ...sentinel, id: identities[index]![at]! })),
  }));
  const incomplete = displacement({ ...recording('lost-anchors', handoff), drags: [drag] });
  expect(incomplete.drags[0]!.complete).toBe(false);
  expect(incomplete.drags[0]!.commonDistance).toBe(30);
  expect(incomplete.unchecked).toEqual([{ frame: 3, reason: 'no-full-drag-anchor' }]);
});

test('stationary held input checks the DOM anchor and conserves input through legitimate height flow', () => {
  const before = frame(0, 100, { moving: true, touching: true });
  const shifted = frame(10, 101, { moving: true, touching: true, structure: true, sentinels: before.sentinels });
  const drifted = displacement({
    ...recording('held-anchor-drift', [before, shifted]),
    drags: [{ distance: 0, speed: 0, fromFrame: 0, toFrame: 1, preventFling: true }],
  });
  expect(drifted.failures).toContainEqual({ kind: 'anchor', frame: 1, sentinel: null, pixels: 1, limit: 0.5 });
  expect(drifted.pairs[0]!.mode).toBe('quiet');
  expect(drifted.drags[0]!.anchors.map((anchor) => anchor.distance)).toEqual([0, 0]);
  const grown = frame(20, 110, {
    moving: true,
    touching: true,
    structure: true,
    sizeChanges: 1,
    scrollHeight: 10020,
    rows: [row('a', box(110, 120, 180)), row('b', box(230, 100))],
    sentinels: [
      { id: 1, row: 'a', rect: box(120, 10, 10), text: 'a' },
      { id: 2, row: 'b', rect: box(240, 10, 10), text: 'b' },
    ],
  });
  const continued = frame(30, 120, {
    moving: true,
    touching: true,
    scrollHeight: 10020,
    rows: [row('a', box(120, 120, 180)), row('b', box(240, 100))],
    sentinels: [
      { id: 1, row: 'a', rect: box(130, 10, 10), text: 'a' },
      { id: 2, row: 'b', rect: box(250, 10, 10), text: 'b' },
    ],
  });
  const clean = displacement({
    ...recording('held-height-flow', [before, frame(10, 110, { moving: true, touching: true }), grown, continued]),
    drags: [
      { distance: 10, speed: 1000, fromFrame: 0, toFrame: 1, preventFling: true },
      { distance: 0, speed: 0, fromFrame: 1, toFrame: 2, preventFling: true },
      { distance: 10, speed: 1000, fromFrame: 2, toFrame: 3, preventFling: true },
    ],
  });
  expect(clean.failures).toEqual([]);
  expect(clean.unchecked).toEqual([]);
  expect(clean.causes.failures).toEqual([]);
  expect(clean.pairs.map((pair) => pair.mode)).toEqual(['drag', 'quiet', 'drag']);
  expect(clean.drags[1]!.anchors.map((anchor) => anchor.distance)).toEqual([0, 0]);
  expect(clean.chains).toEqual([
    { fromSegment: 0, toSegment: 2, commandedDistance: 20, minimum: 20, maximum: 20, error: 0, complete: true },
  ]);
});

test('continuous held segments allow anchor handoffs without multiplying the drift allowance', () => {
  const drags: Drag[] = [
    { distance: 10, speed: 1000, fromFrame: 0, toFrame: 1, preventFling: true },
    { distance: 0, speed: 0, fromFrame: 1, toFrame: 2, preventFling: true },
    { distance: 10, speed: 1000, fromFrame: 2, toFrame: 3, preventFling: true },
  ];
  const identities = [
    [1, 2],
    [1, 12],
    [11, 12],
    [11, 22],
  ];
  const held = (tops: number[]): Recording => ({
    ...recording(
      'held',
      tops.map((top, index) => {
        const one = frame(index * 10, top, { moving: true, structure: index === 2 });
        one.sentinels = one.sentinels.map((sentinel, at) => ({ ...sentinel, id: identities[index]![at]! }));
        return one;
      }),
    ),
    drags,
  });
  const clean = displacement(held([100, 110, 110, 120]));
  expect(clean.failures).toEqual([]);
  expect(clean.unchecked).toEqual([]);
  expect(clean.chains).toEqual([
    { fromSegment: 0, toSegment: 2, commandedDistance: 20, minimum: 20, maximum: 20, error: 0, complete: true },
  ]);
  expect(clean.drags.map((segment) => segment.anchors.length)).toEqual([1, 1, 1]);
  const drifted = displacement(held([100, 110.6, 110.6, 121.2]));
  expect(drifted.drags.every((segment) => segment.complete)).toBe(true);
  expect(drifted.failures.filter((failure) => failure.kind !== 'drag-chain')).toEqual([]);
  expect(drifted.failures.filter((failure) => failure.kind === 'drag-chain').map((failure) => failure.frame)).toEqual([3]);
  expect(drifted.chains[0]!.error).toBeCloseTo(1.2);
  const movingPause = displacement(held([100, 110, 111, 121]));
  expect(movingPause.failures).toContainEqual({ kind: 'quiet', frame: 2, sentinel: 12, pixels: 1, limit: 0.5 });
  const wanderingPause = displacement({
    ...recording(
      'wandering-pause',
      [100, 110, 110.2, 110.4, 110.6, 110.4, 110.2, 110, 120].map((top, index) => frame(index * 10, top, { moving: true })),
    ),
    drags: [drags[0]!, { ...drags[1]!, toFrame: 7 }, { ...drags[2]!, fromFrame: 7, toFrame: 8 }],
  });
  expect(wanderingPause.failures.find((failure) => failure.kind === 'cumulative' && failure.frame === 4)!.pixels).toBeCloseTo(0.6);
  expect(wanderingPause.drags.every((segment) => segment.anchors.every((anchor) => anchor.error === 0))).toBe(true);
  const overlapping = displacement({ ...held([100, 110, 110, 120]), drags: [drags[0]!, { ...drags[1]!, fromFrame: 0 }] });
  expect(overlapping.unchecked).toContainEqual({ frame: 1, reason: 'overlapping-drags' });
});

test('landed navigation permits bounded identity changes but preserves rigidity and post-landing quiet', () => {
  const frames = [frame(0, 100), frame(10, 400, { moving: true }), frame(20, 500), frame(30, 500), frame(40, 501)];
  for (const one of frames.slice(1)) one.sentinels = one.sentinels.map((sentinel) => ({ ...sentinel, id: sentinel.id + 100 }));
  const command: Navigation = { kind: 'rail', target: 'a', fromFrame: 1, toFrame: 2, timeStamp: 1, received: 1 };
  const result = displacement({ ...recording('navigation', frames), commands: [command] });
  expect(result.pairs.map((pair) => pair.mode)).toEqual(['command', 'command', 'quiet', 'quiet']);
  expect(result.pairs[0]!.comparisons).toBe(0);
  expect(result.unchecked).toEqual([]);
  expect(result.failures.filter((failure) => failure.kind === 'quiet').map(({ frame, pixels }) => ({ frame, pixels }))).toEqual([
    { frame: 4, pixels: 1 },
    { frame: 4, pixels: 1 },
  ]);
  const split = frames.map((one, index) => ({
    ...one,
    sentinels: one.sentinels.map((sentinel, at) =>
      index === 2 && at === 1 ? { ...sentinel, rect: box(sentinel.rect.top + 4, 10, 10) } : sentinel,
    ),
  }));
  const inconsistent = displacement({ ...recording('split-navigation', split), commands: [command] });
  expect(inconsistent.failures.filter((failure) => failure.kind === 'common').map((failure) => failure.frame)).toEqual([2, 2]);
  const pending = displacement({ ...recording('pending-navigation', frames), commands: [{ ...command, toFrame: null }] });
  expect(pending.unchecked).toContainEqual({ frame: 1, reason: 'command-not-landed' });
  expect(pending.pairs.some((pair) => pair.mode === 'command')).toBe(false);
  const invalid = displacement({ ...recording('invalid-navigation', frames), commands: [{ ...command, toFrame: frames.length }] });
  expect(invalid.unchecked).toContainEqual({ frame: 0, reason: 'invalid-command' });
});

test('input comparisons use one actual device pixel without widening anchor rigidity', () => {
  const before = frame(0, 100, { moving: true });
  const after = frame(10, 110.75, { moving: true, scrollTop: 990 });
  expect(displacement(recording('pixel-one', [before, after])).failures).toEqual([]);
  const dense = displacement(
    recording('pixel-half', [
      { ...before, dpr: 2 },
      { ...after, dpr: 2 },
    ]),
  );
  expect(dense.failures.map((failure) => failure.limit)).toEqual([0.5, 0.5]);
  const drag = { distance: 480, speed: 240, fromFrame: 0, toFrame: 1, preventFling: true };
  const endpoint = [frame(0, 100), frame(1000, 581)];
  expect(displacement({ ...recording('one-pixel-endpoint', endpoint), drags: [drag] }).failures).toEqual([]);
  const denseEnd = displacement({
    ...recording(
      'half-pixel-endpoint',
      endpoint.map((one) => ({ ...one, dpr: 2 })),
    ),
    drags: [drag],
  });
  expect(denseEnd.failures.filter((failure) => failure.kind === 'drag-distance').map((failure) => failure.limit)).toEqual([0.5, 0.5]);
  const anchor = displacement(recording('css-anchor', [frame(0, 100), frame(10, 100.75)]));
  expect(anchor.failures).toContainEqual({ kind: 'anchor', frame: 1, sentinel: null, pixels: 0.75, limit: 0.5 });
  expect(displacement(recording('invalid-scale', [{ ...before, dpr: 0 }, after])).unchecked).toContainEqual({
    frame: 1,
    reason: 'invalid-dpr',
  });
  const missing = { ...before };
  Reflect.deleteProperty(missing, 'dpr');
  expect(displacement(recording('missing-scale', [missing, after])).unchecked).toContainEqual({ frame: 1, reason: 'invalid-dpr' });
  expect(displacement(recording('changed-scale', [before, { ...after, dpr: 2 }])).unchecked).toContainEqual({
    frame: 1,
    reason: 'dpr-changed',
  });
});

test('discrete wheel steps sum trusted frame deltas through structural changes without momentum controls', () => {
  const frames = [
    frame(0, 100),
    frame(10, 115, { moving: true }),
    frame(20, 115, { moving: true, structure: true, scrollTop: 2000, scrollHeight: 12000 }),
    frame(30, 111, { moving: true, scrollTop: 2004, scrollHeight: 12000 }),
    frame(40, 111, { scrollTop: 2004, scrollHeight: 12000 }),
  ];
  const run: WheelRun = {
    fromFrame: 0,
    toFrame: 3,
    steps: [
      { frame: 1, deltaY: -10, deltaMode: 0 },
      { frame: 1, deltaY: -5, deltaMode: 0 },
      { frame: 3, deltaY: 4, deltaMode: 0 },
    ],
  };
  const clean = displacement({ ...recording('wheel', frames), wheels: [run] });
  expect(clean.failures).toEqual([]);
  expect(clean.unchecked).toEqual([]);
  expect(clean.pairs.map((pair) => pair.mode)).toEqual(['wheel', 'wheel', 'wheel', 'quiet']);
  expect(clean.pairs.slice(0, 3).map((pair) => pair.wheelDelta)).toEqual([15, 0, -4]);
  const wrong = [...frames];
  wrong[1] = frame(10, 117, { moving: true });
  expect(displacement({ ...recording('wrong-wheel', wrong), wheels: [run] }).failures).toContainEqual({
    kind: 'wheel',
    frame: 1,
    sentinel: null,
    pixels: 2,
    limit: 1,
  });
  const split = frames.map((one, index) => ({
    ...one,
    sentinels: one.sentinels.map((sentinel, at) =>
      index === 1 && at === 1 ? { ...sentinel, rect: box(sentinel.rect.top + 1.5, 10, 10) } : sentinel,
    ),
  }));
  expect(
    displacement({ ...recording('split-wheel', split), wheels: [run] }).failures.some(
      (failure) => failure.kind === 'common' && failure.limit === 0.5,
    ),
  ).toBe(true);
  const lines = { ...run, steps: [{ frame: 1, deltaY: -1, deltaMode: 1 }] };
  expect(displacement({ ...recording('wheel-unit', frames), wheels: [lines] }).unchecked).toContainEqual({
    frame: 1,
    reason: 'wheel-unit',
  });
  const outside = { ...run, steps: [{ frame: 4, deltaY: 4, deltaMode: 0 }] };
  expect(displacement({ ...recording('wheel-range', frames), wheels: [outside] }).unchecked).toContainEqual({
    frame: 0,
    reason: 'invalid-wheel',
  });
});

test('control calibration discards dirty recordings and requires five clean, observed flings', () => {
  const measured = controls();
  const resized = recording(
    'resized',
    measured[0]!.frames.map((one, index) => ({ ...one, sizeChanges: index === 1 ? 1 : 0 })),
  );
  const unmeasured = recording(
    'unknown-row',
    measured[0]!.frames.map((one, index) => ({ ...one, unmeasured: index === 1 ? 1 : 0 })),
  );
  const envelope = controlEnvelope([...measured, resized, unmeasured]);
  expect(envelope.status).toBe('ready');
  expect(envelope.controls).toBe(5);
  expect(envelope.discarded).toEqual([
    { name: 'resized', frame: 1, reason: 'size-change' },
    { name: 'unknown-row', frame: 1, reason: 'unmeasured-row' },
  ]);
  expect(envelope.curves[0]!.samples).toEqual([
    { frame: 2, previousDelta: 20, delta: 10, change: 10 },
    { frame: 3, previousDelta: 10, delta: 5, change: 5 },
  ]);
  expect(controlEnvelope(measured.slice(1)).status).toBe('insufficient');
  const nonrigid = controls([100, 110, 115]);
  for (const [index, sentinel] of nonrigid[4]!.frames[1]!.sentinels.entries()) {
    sentinel.rect = box(sentinel.rect.top + (index === 0 ? -1 : 1), 10, 10);
  }
  const rejected = controlEnvelope(nonrigid);
  expect(rejected.status).toBe('insufficient');
  expect(rejected.controls).toBe(4);
  expect(rejected.discarded).toEqual([{ name: 'control-4', frame: 1, reason: 'control-rigidity' }]);
  const described = controls([100, 110, 130, 140, 145]).map((one) => ({
    ...one,
    frames: one.frames.map((sample) => ({ ...sample, touching: true })),
    drags: [{ distance: 10, speed: 1000, fromFrame: 0, toFrame: 1, preventFling: false }],
  }));
  expect(controlEnvelope(described).status).toBe('ready');
  const invalid = controlEnvelope([recording('empty', []), recording('time', [frame(0, 100), frame(0, 110), frame(10, 120)])]);
  expect(invalid.discarded.map((one) => one.reason)).toEqual(['insufficient-frames', 'invalid-time']);
});

test('fling bounds use raw adjacent common deltas, independent of frame intervals', () => {
  const envelope = controlEnvelope(controls());
  expect(envelope.maximumChange).toBe(10);
  const varied = controls();
  varied[4] = recording(
    'largest-control',
    [100, 200, 250].map((top, index) => frame(index * 10, top, { moving: true })),
  );
  expect(controlEnvelope(varied).maximumChange).toBe(50);
  const variable = displacement(
    recording('variable-cadence', [
      frame(0, 100, { moving: true }),
      frame(10, 120, { moving: true }),
      frame(30, 160, { moving: true, structure: true }),
    ]),
    envelope,
  );
  expect(variable.failures).toEqual([{ kind: 'momentum', frame: 2, sentinel: null, pixels: 20, limit: 10 }]);
  expect(variable.unchecked).toEqual([]);
  const raw = displacement(
    recording('raw-eighteen-to-nineteen', [
      frame(0, 100, { moving: true }),
      frame(8, 118, { moving: true }),
      frame(40, 137, { moving: true, structure: true }),
    ]),
    controlEnvelope(controls([100, 118, 137, 155])),
  );
  expect(raw.failures).toEqual([]);
  expect(raw.unchecked).toEqual([]);
  expect(raw.pairs[1]!.change).toBe(1);
  expect(raw.pairs[1]!.limit).toBe(1);
  const faster = displacement(
    recording('large-raw-change', [
      frame(0, 100, { moving: true }),
      frame(10, 220, { moving: true }),
      frame(20, 220, { moving: true, structure: true }),
    ]),
    envelope,
  );
  expect(faster.unchecked).toEqual([]);
  expect(faster.failures).toEqual([{ kind: 'momentum', frame: 2, sentinel: null, pixels: 120, limit: 10 }]);
  const afterStroke = displacement(
    {
      ...recording('known-release', [
        frame(0, 100, { moving: true, touching: true }),
        frame(10, 105, { moving: true, touching: true }),
        frame(20, 125, { moving: true, touching: true }),
        frame(30, 120, { moving: true, touching: true, structure: true }),
      ]),
      drags: [{ distance: 5, speed: 500, fromFrame: 0, toFrame: 1, preventFling: false }],
    },
    envelope,
  );
  expect(afterStroke.failures).toEqual([{ kind: 'momentum', frame: 3, sentinel: null, pixels: 25, limit: 10 }]);
  expect(afterStroke.unchecked).toEqual([]);
  expect(afterStroke.drags[0]!.anchors).toEqual([]);
});
