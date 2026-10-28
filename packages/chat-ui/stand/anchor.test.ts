import { expect, test } from 'bun:test';
import { anchorFlow } from './anchor';
import { displacement } from './displacement';
import type { Anchor, Frame, Recording, Rect, RowRect, RowSignature } from './recording';

const box = (top: number, height: number, width = 200): Rect => ({ top, bottom: top + height, left: 0, right: width, height, width });
const signature = (): RowSignature => ({ text: 1, structure: 1, images: [], anchors: [], expanded: [], font: 'test', fonts: 'loaded' });
const row = (key: string, top: number, height: number, width = 200): RowRect => ({
  key,
  rect: box(top, height, width),
  signature: signature(),
  live: false,
});
const frame = (rows: RowRect[], anchor: Anchor | null, time = 0, patch: Partial<Frame> = {}): Frame => ({
  time,
  sampled: time,
  dpr: 1,
  scrollTop: 0,
  scrollHeight: 1000,
  viewport: box(-100, 1000, 500),
  rows,
  anchor,
  sentinels: [],
  blank: 0,
  rail: false,
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
  changes: [],
  mounts: [],
  ...patch,
});
const recording = (frames: Frame[]): Recording => ({ name: 'anchor', frames, touches: [], drags: [], wheels: [] });

test('paused flow accounts for multiple inserted rows and height changes on both sides', () => {
  const beforeRows = [row('above', 0, 50), row('anchor', 50, 50), row('below', 100, 50)];
  const afterRows = [
    row('above', -20, 70),
    row('anchor', 50, 70),
    row('insert-a', 120, 10),
    row('insert-b', 130, 20),
    row('below', 150, 50),
  ];
  const before = frame(beforeRows, { kind: 'paused', row: 'anchor', rect: beforeRows[1]!.rect });
  const after = frame(afterRows, { kind: 'paused', row: 'anchor', rect: afterRows[1]!.rect }, 10);
  const flow = anchorFlow(before, after, 1);
  if ('reason' in flow) throw new Error(flow.reason);
  expect(flow.shift).toBe(0);
  expect(flow.expected('above')).toEqual({ pixels: -20 });
  expect(flow.expected('anchor')).toEqual({ pixels: 0 });
  expect(flow.expected('below')).toEqual({ pixels: 50 });
  expect(flow.expected('unmounted')).toEqual({ frame: 1, row: 'unmounted', reason: 'anchor-region' });
  const changed = anchorFlow(before, { ...after, anchor: { kind: 'paused', row: 'below', rect: afterRows[4]!.rect } }, 1);
  expect(changed).toEqual({ frame: 1, row: 'below', reason: 'anchor-changed' });
});

test('following normalizes the tail to the viewport and permits a new last-row identity', () => {
  const beforeRows = [row('above', 0, 50), row('tail', 50, 50)];
  const afterRows = [row('above', -40, 50), row('tail', 10, 70)];
  const before = frame(beforeRows, { kind: 'following', row: 'tail', rect: beforeRows[1]!.rect }, 0, { viewport: box(0, 100) });
  const after = frame(afterRows, { kind: 'following', row: 'tail', rect: afterRows[1]!.rect }, 10, { viewport: box(0, 80) });
  const flow = anchorFlow(before, after, 1);
  if ('reason' in flow) throw new Error(flow.reason);
  expect(flow.identity).toBe('following');
  expect(flow.shift).toBe(0);
  expect(flow.expected('above')).toEqual({ pixels: -40 });
  expect(flow.expected('tail')).toEqual({ pixels: -40 });
  const appendedRows = [row('above', -20, 50), row('tail', 30, 50), row('appended', 80, 20)];
  const appended = anchorFlow(
    before,
    frame(appendedRows, { kind: 'following', row: 'appended', rect: appendedRows[2]!.rect }, 10, { viewport: box(0, 100) }),
    1,
  );
  if ('reason' in appended) throw new Error(appended.reason);
  expect(appended.shift).toBe(0);
  expect(appended.expected('tail')).toEqual({ pixels: -20 });
});

test('tail-held geometry cannot exempt a cold visible markup shrink', () => {
  const beforeRows = [row('above', 0, 50), row('tail', 50, 70)];
  const afterRows = [row('above', 20, 50), row('tail', 70, 50)];
  afterRows[1]!.signature.structure = 2;
  const before = frame(beforeRows, { kind: 'following', row: 'tail', rect: beforeRows[1]!.rect }, 0, {
    viewport: box(0, 120),
    sentinels: [
      { id: 1, row: 'above', rect: box(10, 10, 10), text: 'a' },
      { id: 2, row: 'tail', rect: box(60, 10, 10), text: 'b' },
    ],
  });
  const after = frame(afterRows, { kind: 'following', row: 'tail', rect: afterRows[1]!.rect }, 10, {
    viewport: box(0, 120),
    sentinels: [
      { id: 1, row: 'above', rect: box(30, 10, 10), text: 'a' },
      { id: 2, row: 'tail', rect: box(80, 10, 10), text: 'b' },
    ],
  });
  const result = displacement(recording([before, after]));
  expect(result.failures).toEqual([]);
  expect(result.unchecked).toEqual([]);
  expect(result.comparisons).toBe(2);
  expect(result.causes.failures.map(({ key, delta, cause }) => ({ key, delta, cause }))).toEqual([
    { key: 'tail', delta: -20, cause: 'markup' },
  ]);
});

test('pressed controls use their observed pre-click point and reject incomplete flow regions', () => {
  const beforeRows = [row('above', 0, 50), row('control', 50, 40), row('below', 90, 50)];
  const afterRows = [row('above', 0, 50), row('control', 50, 70), row('inserted', 120, 20), row('below', 140, 50)];
  const control = box(55, 10, 10);
  const before = frame(beforeRows, { kind: 'paused', row: 'above', rect: beforeRows[0]!.rect }, 0, { control });
  const after = frame(afterRows, { kind: 'disclosure', row: 'control', rect: control }, 10, { control, controlRow: 'control' });
  const flow = anchorFlow(before, after, 1);
  if ('reason' in flow) throw new Error(flow.reason);
  expect(flow.shift).toBe(0);
  expect(flow.expected('above')).toEqual({ pixels: 0 });
  expect(flow.expected('below')).toEqual({ pixels: 50 });
  const gapped = anchorFlow(before, { ...after, rows: afterRows.filter((one) => one.key !== 'inserted') }, 1);
  if ('reason' in gapped) throw new Error(gapped.reason);
  expect(gapped.expected('below')).toEqual({ frame: 1, row: 'below', reason: 'anchor-region' });
  const inset = anchorFlow(before, { ...after, anchor: { kind: 'disclosure', row: 'control', rect: box(56, 10, 10) } }, 1);
  if ('reason' in inset) throw new Error(inset.reason);
  expect(inset.shift).toBe(1);
  expect(inset.expected('below')).toEqual({ frame: 1, row: 'below', reason: 'anchor-inset' });
});

test('quiet width reflow proves the DOM row anchor without inventing retained-text comparisons', () => {
  const beforeRow = row('only', 10, 100, 200);
  const afterRow = row('only', 10, 200, 100);
  const before = frame([beforeRow], { kind: 'paused', row: 'only', rect: beforeRow.rect }, 0, {
    sentinels: [{ id: 1, row: 'only', rect: box(20, 10, 10), text: 'paragraph' }],
  });
  const after = frame([afterRow], { kind: 'paused', row: 'only', rect: afterRow.rect }, 10, {
    structure: true,
    sentinels: [{ id: 1, row: 'only', rect: box(40, 10, 10), text: 'paragraph' }],
  });
  const result = displacement(recording([before, after]));
  expect(result.anchorComparisons).toBe(1);
  expect(result.comparisons).toBe(0);
  expect(result.pairs[0]!.excluded).toBe(1);
  expect(result.failures).toEqual([]);
  expect(result.unchecked).toEqual([]);
  expect(result.causes.failures).toEqual([]);
  const thirdRow = row('only', 10.3, 300, 80);
  const fourthRow = row('only', 10.6, 400, 60);
  const third = frame([thirdRow], { kind: 'paused', row: 'only', rect: thirdRow.rect }, 20, {
    sentinels: [{ id: 1, row: 'only', rect: box(70, 10, 10), text: 'paragraph' }],
  });
  const fourth = frame([fourthRow], { kind: 'paused', row: 'only', rect: fourthRow.rect }, 30, {
    sentinels: [{ id: 1, row: 'only', rect: box(100, 10, 10), text: 'paragraph' }],
  });
  const drifting = displacement(recording([before, after, third, fourth]));
  expect(drifting.comparisons).toBe(0);
  expect(drifting.failures.some((failure) => failure.kind === 'anchor-cumulative' && failure.frame === 3)).toBe(true);
});
