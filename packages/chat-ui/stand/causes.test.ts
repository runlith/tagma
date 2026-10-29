import { expect, test } from 'bun:test';
import { causes, type Cause } from './causes';
import type { Frame, Recording, Rect, RowRect, RowSignature } from './recording';

const box = (height = 100, width = 200, top = 0): Rect => ({ top, bottom: top + height, left: 0, right: width, height, width });
const signature = (patch: Partial<RowSignature> = {}): RowSignature => ({
  text: 1,
  structure: 1,
  images: [],
  anchors: [],
  expanded: [],
  font: 'font',
  fonts: 'loaded',
  ...patch,
});
const row = (key: string, height: number, patch: Partial<RowRect> = {}): RowRect => ({
  key,
  rect: box(height),
  signature: signature(),
  live: false,
  ...patch,
});
const frame = (rows: RowRect[], patch: Partial<Frame> = {}): Frame => ({
  time: 0,
  sampled: 0,
  dpr: 1,
  scrollTop: 0,
  scrollHeight: 1000,
  viewport: box(500, 500),
  rows,
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
  anchor: null,
  changes: [],
  mounts: [],
  ...patch,
});
const recording = (...frames: Frame[]): Recording => ({ name: 'test', frames, touches: [], drags: [], wheels: [] });

test('visible height changes are attributed in DOM priority order', () => {
  const image = { source: 2, complete: true, width: 20, height: 20 };
  const order: Cause[] = ['reference', 'image', 'markup', 'text', 'font', 'other'];
  const before = order.map((key) => row(key, 100));
  const after = [
    row('reference', 110, { signature: signature({ anchors: ['resolved'], images: [image], structure: 2, text: 2, font: 'new' }) }),
    row('image', 110, { signature: signature({ images: [image], structure: 2, text: 2 }) }),
    row('markup', 110, { signature: signature({ structure: 2, text: 2 }) }),
    row('text', 110, { signature: signature({ text: 2, font: 'new' }) }),
    row('font', 110, { signature: signature({ fonts: 'loading' }) }),
    row('other', 110),
  ];
  const result = causes(recording(frame(before), frame(after)));
  expect(result.changes.map(({ key, frame, delta, cause, allowance }) => ({ key, frame, delta, cause, allowance }))).toEqual(
    order.map((key) => ({ key, frame: 1, delta: 10, cause: key, allowance: null })),
  );
  expect(result.failures).toEqual(result.changes);
  expect(result.unchecked).toEqual([]);
});

test('only actual same-row width changes and text-backed live growth permit size changes', () => {
  const before = [
    row('width', 100),
    row('live', 100, { live: true }),
    row('shrink', 100, { live: true }),
    row('image', 100, { live: true }),
    row('cold', 100),
  ];
  const after = [
    row('width', 110, { rect: box(110, 180) }),
    row('live', 110, { live: true, signature: signature({ text: 2 }) }),
    row('shrink', 90, { live: true, signature: signature({ text: 2 }) }),
    row('image', 110, { live: true, signature: signature({ images: [{ source: 1, complete: true, width: 20, height: 20 }] }) }),
    row('cold', 110, { signature: signature({ text: 2 }) }),
  ];
  const result = causes(recording(frame(before), frame(after, { controlRow: 'cold' })));
  expect(result.changes.map(({ key, allowance }) => [key, allowance])).toEqual([
    ['width', 'width'],
    ['live', 'live-growth'],
    ['shrink', null],
    ['image', null],
    ['cold', null],
  ]);
  expect(result.failures.map(({ key }) => key)).toEqual(['shrink', 'image', 'cold']);
});

test('disclosure allowance follows the pressed control transition or its finite animation', () => {
  const first = frame([row('pressed', 100), row('nested', 100)], { controlRow: 'pressed', controlExpanded: 'false' });
  const toggled = frame([row('pressed', 120), row('nested', 120, { signature: signature({ expanded: ['true'] }) })], {
    controlRow: 'pressed',
    controlExpanded: 'true',
  });
  const animated = frame([row('pressed', 41), row('nested', 120)], {
    controlRow: 'pressed',
    controlExpanded: 'false',
    controlAnimating: true,
  });
  const settled = frame([row('pressed', 40), row('nested', 120)], { controlRow: 'pressed', controlExpanded: 'false' });
  const cold = frame([row('pressed', 50), row('nested', 120)], { controlRow: 'pressed', controlExpanded: 'false' });
  const result = causes(recording(first, toggled, animated, settled, cold));
  expect(result.changes.map(({ frame, key, allowance }) => ({ frame, key, allowance }))).toEqual([
    { frame: 1, key: 'pressed', allowance: 'disclosure' },
    { frame: 1, key: 'nested', allowance: null },
    { frame: 2, key: 'pressed', allowance: 'disclosure' },
    { frame: 3, key: 'pressed', allowance: 'disclosure' },
    { frame: 4, key: 'pressed', allowance: null },
  ]);
  expect(result.failures.map(({ frame, key }) => ({ frame, key }))).toEqual([
    { frame: 1, key: 'nested' },
    { frame: 4, key: 'pressed' },
  ]);
  const unknown = causes(recording(first, frame([row('pressed', 110)], { controlRow: 'pressed', controlExpanded: null })));
  expect(unknown.failures.map(({ key }) => key)).toEqual(['pressed']);
});

test('rows must overlap a viewport and malformed pair evidence is unchecked', () => {
  const first = frame([row('offscreen', 100, { rect: box(100, 200, 600) }), row('bad', 100), row('duplicate', 100), row('duplicate', 100)]);
  const second = frame([
    row('offscreen', 110, { rect: box(110, 200, 600) }),
    row('bad', 100, { rect: box(NaN) }),
    row('duplicate', 120),
    row('new', 100),
  ]);
  const result = causes(recording(first, second));
  expect(result.changes).toEqual([]);
  expect(result.unchecked).toEqual([
    { frame: 1, key: 'duplicate', reason: 'duplicate-key' },
    { frame: 1, key: 'bad', reason: 'invalid-geometry' },
  ]);
  expect(causes(recording(first)).unchecked).toEqual([{ frame: 0, key: null, reason: 'insufficient-frames' }]);
});
