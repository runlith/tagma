import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Seam, type SeamPane, type SeamReport } from './Seam.svelte';

const VIEWPORT = 1440;
const COLUMN: SeamPane = { size: 240, base: 240, min: 192, max: 480, share: 1 / 3 };

beforeEach(() => {
  setViewport(VIEWPORT);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
}

function pointer(type: string, x: number): PointerEvent {
  return new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, clientY: 300, bubbles: true });
}

function keystroke(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

function drag(seam: Seam, from: number, to: number): void {
  seam.grab(pointer('pointerdown', from));
  window.dispatchEvent(pointer('pointermove', to));
  window.dispatchEvent(pointer('pointerup', to));
}

function held(collapsible = false): { seam: Seam; commits: number[]; collapses: string[] } {
  const commits: number[] = [];
  const collapses: string[] = [];
  const report: SeamReport = { onCommit: (size) => commits.push(size) };
  if (collapsible) report.onCollapse = () => collapses.push('collapsed');
  const seam = new Seam(COLUMN, report);
  seam.measure();
  return { seam, commits, collapses };
}

test('a pane opens at the size it was handed', () => {
  const seam = new Seam(COLUMN);

  expect(seam.size).toBe(240);
  expect(seam.dragging).toBe(false);
});

test('a drag moves the pane with the pointer and commits the settled size once', () => {
  const { seam, commits } = held();

  seam.grab(pointer('pointerdown', 240));
  window.dispatchEvent(pointer('pointermove', 300));
  expect(seam.size).toBe(300);
  expect(seam.dragging).toBe(true);
  expect(commits).toEqual([]);

  window.dispatchEvent(pointer('pointerup', 300));
  expect(commits).toEqual([300]);
  expect(seam.dragging).toBe(false);
});

test('a drag stops at the floor and at the ceiling, wherever the pointer goes', () => {
  const { seam } = held();

  drag(seam, 240, -400);
  expect(seam.size).toBe(192);

  drag(seam, 192, 4000);
  expect(seam.size).toBe(480);
});

test('the share of the viewport is the tighter ceiling in a narrow window', () => {
  setViewport(900);
  const { seam } = held();

  drag(seam, 240, 4000);

  expect(seam.size).toBe(300);
});

test('a contained pane takes its share of the container, and of the window again once released', () => {
  const { seam } = held();
  const row = document.createElement('div');
  Object.defineProperty(row, 'clientWidth', { value: 600, configurable: true });
  const release = seam.contain(row);

  drag(seam, 240, 4000);
  expect(seam.size).toBe(200);

  release();
  drag(seam, seam.size, 4000);
  expect(seam.size).toBe(480);
});

test('a pane nobody sized follows its fill of the container until a drag sizes it', () => {
  const seam = new Seam({ base: 300, min: 200, max: 2000, fill: 1 / 2 });
  const row = document.createElement('div');
  let width = 1000;
  Object.defineProperty(row, 'clientWidth', { get: () => width, configurable: true });
  seam.contain(row);
  expect(seam.size).toBe(500);

  width = 800;
  seam.measure();
  expect(seam.size).toBe(400);

  drag(seam, 400, 450);
  width = 1200;
  seam.measure();
  expect(seam.size).toBe(450);
});

test('a window that shrank holds the pane inside it and gives the width back when it grows', () => {
  const { seam } = held();
  drag(seam, 240, 460);
  expect(seam.size).toBe(460);

  setViewport(900);
  seam.measure();
  expect(seam.size).toBe(300);

  setViewport(VIEWPORT);
  seam.measure();
  expect(seam.size).toBe(460);
});

test('the keyboard sizes the pane: one step per arrow, the limits, and the base back', () => {
  const { seam, commits } = held();

  seam.key(keystroke('ArrowRight'));
  expect(seam.size).toBe(256);
  seam.key(keystroke('ArrowLeft'));
  expect(seam.size).toBe(240);

  seam.key(keystroke('Home'));
  expect(seam.size).toBe(192);
  seam.key(keystroke('End'));
  expect(seam.size).toBe(480);

  seam.key(keystroke('Enter'));
  expect(seam.size).toBe(240);

  expect(commits).toEqual([256, 240, 192, 480, 240]);
});

test('a key the seam does not own is left to whoever else wants it', () => {
  const { seam, commits } = held();

  const event = keystroke('Tab');
  seam.key(event);

  expect(event.defaultPrevented).toBe(false);
  expect(commits).toEqual([]);
});

test('a drag released below half the floor collapses the pane and commits no size', () => {
  const { seam, commits, collapses } = held(true);

  seam.grab(pointer('pointerdown', 240));
  window.dispatchEvent(pointer('pointermove', 80));
  expect(seam.size).toBe(192);
  expect(seam.willCollapse).toBe(true);

  window.dispatchEvent(pointer('pointerup', 80));
  expect(collapses).toEqual(['collapsed']);
  expect(commits).toEqual([]);
});

test('a host that declared no collapse only ever reaches the floor', () => {
  const { seam, commits } = held();

  drag(seam, 240, 0);

  expect(seam.willCollapse).toBe(false);
  expect(commits).toEqual([192]);
});

test('a pane docked at the end grows as the pointer travels the other way', () => {
  const commits: number[] = [];
  const seam = new Seam({ ...COLUMN, side: 'start' }, { onCommit: (size) => commits.push(size) });
  seam.measure();

  drag(seam, 1200, 1140);

  expect(commits).toEqual([300]);
});

test('a gesture suppresses text selection and holds the resize cursor, then gives both back', () => {
  document.body.style.userSelect = 'text';
  document.body.style.cursor = 'crosshair';
  const { seam } = held();

  seam.grab(pointer('pointerdown', 240));
  expect(document.body.style.userSelect).toBe('none');
  expect(document.body.style.cursor).toBe('col-resize');

  window.dispatchEvent(pointer('pointerup', 240));
  expect(document.body.style.userSelect).toBe('text');
  expect(document.body.style.cursor).toBe('crosshair');
});

test('a second pointer cannot steer a gesture that is not its own', () => {
  const { seam } = held();
  seam.grab(pointer('pointerdown', 240));

  window.dispatchEvent(new PointerEvent('pointermove', { button: 0, pointerId: 2, clientX: 700, clientY: 300, bubbles: true }));

  expect(seam.size).toBe(240);
});

test('Escape puts the pane back where the drag found it and commits nothing', () => {
  const { seam, commits } = held();
  seam.grab(pointer('pointerdown', 240));
  window.dispatchEvent(pointer('pointermove', 400));

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  expect(seam.dragging).toBe(false);
  expect(seam.size).toBe(240);
  expect(commits).toEqual([]);
});

function split(span: number, fill: number, report: SeamReport): Seam {
  const seam = new Seam({ base: 0, min: 50, max: Number.POSITIVE_INFINITY, rest: 50, fill }, report);
  const row = document.createElement('div');
  Object.defineProperty(row, 'clientWidth', { value: span + 3, configurable: true });
  seam.contain(row, 3);
  return seam;
}

test('a split leaves both panes their floor and commits the share of the span it lands at', () => {
  const fills: number[] = [];
  const seam = split(400, 0.5, { onCommit: (_size, fill) => fills.push(fill) });

  drag(seam, 200, -1000);
  drag(seam, 50, 4000);

  expect(fills).toEqual([50 / 400, 350 / 400]);
});

test('a split narrower than both floors stands in the middle', () => {
  const commits: number[] = [];
  const seam = split(60, 0.5, { onCommit: (size) => commits.push(size) });

  drag(seam, 30, -100);
  drag(seam, 30, 100);

  expect(commits).toEqual([30, 30]);
});

test('a drag reports where it is once a frame, however many moves the frame saw', () => {
  const frames: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
  const fills: number[] = [];
  const seam = split(400, 0.5, { onDrag: (_size, fill) => fills.push(fill) });

  seam.grab(pointer('pointerdown', 200));
  window.dispatchEvent(pointer('pointermove', 190));
  window.dispatchEvent(pointer('pointermove', 180));
  window.dispatchEvent(pointer('pointermove', 170));
  expect(fills).toEqual([]);
  for (const frame of frames.splice(0)) frame();

  expect(fills).toEqual([170 / 400]);
  window.dispatchEvent(pointer('pointerup', 170));
});

test('a lost window puts a split back at the share it was grabbed at and lets go of what the grab held', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const fills: number[] = [];
  const commits: number[] = [];
  let released = 0;
  const seam = split(400, 0.75, {
    onGrab: () => () => (released += 1),
    onDrag: (_size, fill) => fills.push(fill),
    onCommit: (size) => commits.push(size),
  });

  seam.grab(pointer('pointerdown', 300));
  window.dispatchEvent(pointer('pointermove', 120));
  window.dispatchEvent(new Event('blur'));

  expect(fills.at(-1)).toBe(0.75);
  expect(commits).toEqual([]);
  expect(released).toBe(1);
});

test('disposing ends a gesture in flight and gives the page back', () => {
  document.body.style.userSelect = 'text';
  const { seam, commits } = held();
  seam.grab(pointer('pointerdown', 240));

  seam.dispose();

  expect(seam.dragging).toBe(false);
  expect(document.body.style.userSelect).toBe('text');
  window.dispatchEvent(pointer('pointermove', 700));
  expect(seam.size).toBe(240);
  expect(commits).toEqual([]);
});
