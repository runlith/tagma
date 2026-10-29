// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';
import { ColumnWindow } from './ColumnWindow.svelte.js';

type Line = { readonly key: string };

const lines = (count: number): Line[] => Array.from({ length: count }, (_unused, index) => ({ key: `line-${index}` }));

let leave: (() => void) | undefined;

afterEach(() => {
  leave?.();
  leave = undefined;
});

function scroller(height: number, total: () => number): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { value: height });
  Object.defineProperty(element, 'offsetHeight', { value: height });
  Object.defineProperty(element, 'scrollHeight', { get: total });
  element.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    element.scrollTop = typeof options === 'number' ? (y ?? options) : (options?.top ?? element.scrollTop);
    element.dispatchEvent(new Event('scroll'));
  };
  return element;
}

test('1000 lines mount only the window around the viewport', () => {
  const win = new ColumnWindow<Line>(() => 26);
  win.lay(lines(1000));

  const mounted = win.mounted();
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted.length).toBeLessThan(60);
  expect(mounted[0]?.index).toBe(0);
  expect(win.height).toBe(1000 * 27 - 1);
});

test('scrolling to a line carries the window there, and a kept line stays mounted wherever the window is', () => {
  const win = new ColumnWindow<Line>(() => 26);
  const element = scroller(400, () => win.height);
  leave = win.column(element) as (() => void) | undefined;
  win.lay(lines(1000));

  win.scrollTo(700);
  const mounted = win.mounted(new Set(['line-3']));
  const indices = mounted.map((placed) => placed.index);

  expect(indices).toContain(700);
  expect(indices).toContain(3);
  expect(indices).not.toContain(300);
  expect(indices.length).toBeLessThan(60);
});

test('the window keeps its anchor line when lines appear above it', () => {
  const win = new ColumnWindow<Line>(() => 26);
  const element = scroller(400, () => win.height);
  leave = win.column(element) as (() => void) | undefined;
  const base = lines(200);
  win.lay(base);
  win.scrollTo(100);
  const before = win.offset(100) - element.scrollTop;

  win.lay([...lines(10).map((line) => ({ key: `new-${line.key}` })), ...base]);

  expect(win.offset(win.indexFor('line-100')) - element.scrollTop).toBe(before);
});

test('an interior reorder keeps the key and offset being read when count and edge keys stay the same', () => {
  const win = new ColumnWindow<Line>(() => 26);
  const element = scroller(54, () => win.height);
  leave = win.column(element) as (() => void) | undefined;
  const base = lines(8);
  win.lay(base);
  element.scrollTop = win.offset(4) + 5;
  element.dispatchEvent(new Event('scroll'));
  const before = win.offset(4) - element.scrollTop;

  win.lay([base[0]!, ...base.slice(2, 7), base[1]!, base[7]!]);

  expect(win.offset(win.indexFor('line-4')) - element.scrollTop).toBe(before);
});

test('a preceding block changing height updates scroll targets without an outer resize', () => {
  const watchers: { targets: Set<Element>; changed: ResizeObserverCallback }[] = [];
  const view = document.defaultView!;
  const standing = view.ResizeObserver;
  const Observer = class {
    private readonly watcher: { targets: Set<Element>; changed: ResizeObserverCallback };
    constructor(changed: ResizeObserverCallback) {
      this.watcher = { targets: new Set(), changed };
      watchers.push(this.watcher);
    }
    observe(target: Element): void {
      this.watcher.targets.add(target);
    }
    unobserve(target: Element): void {
      this.watcher.targets.delete(target);
    }
    disconnect(): void {
      this.watcher.targets.clear();
    }
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal('ResizeObserver', Observer);
  view.ResizeObserver = Observer;
  let margin = 0;
  const win = new ColumnWindow<Line>(() => 26);
  const element = scroller(27, () => win.height + margin);
  const prefix = document.createElement('div');
  const span = document.createElement('div');
  element.append(prefix, span);
  document.body.append(element);
  Object.defineProperty(span, 'offsetTop', { get: () => margin });
  leave = win.column(element) as (() => void) | undefined;
  const release = win.span(span) as (() => void) | undefined;
  try {
    win.lay(lines(8));
    margin = 100;
    for (const watcher of watchers)
      if (watcher.targets.has(prefix)) {
        watcher.changed([{ target: prefix } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      }

    win.scrollTo(4);

    expect(element.scrollTop).toBe(win.offset(4) + margin + 26 - 27);
  } finally {
    release?.();
    leave?.();
    leave = undefined;
    element.remove();
    view.ResizeObserver = standing;
    vi.unstubAllGlobals();
  }
});

test('a line laid again as a fresh object keeps the measure attachment, so its element is not attached again', () => {
  const win = new ColumnWindow<Line>(() => 26);
  win.lay(lines(10));
  const measured = win.measure('line-3');

  win.lay(lines(10).map((line) => ({ ...line })));

  expect(win.measure('line-3')).toBe(measured);
});

test('laying a changed list over the last one gives the offsets a fresh layout of it would', () => {
  const sizeOf = (line: Line) => 20 + (Number(line.key.slice(5)) % 7);
  const win = new ColumnWindow<Line>(sizeOf);
  const all = lines(300);
  let state = 11;
  const random = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  let current = all.slice(0, 150);
  win.lay(current);
  for (let step = 0; step < 6; step += 1) {
    const at = Math.floor(random() * current.length);
    current =
      random() < 0.5
        ? [...current.slice(0, at), ...all.slice(150 + (step % 100), 150 + (step % 100) + 1 + (step % 3)), ...current.slice(at)]
        : [...current.slice(0, at), ...current.slice(at + 1 + (step % 4))];
    win.lay(current);
    const fresh = new ColumnWindow<Line>(sizeOf);
    fresh.lay(current);
    expect(win.height).toBe(fresh.height);
    for (let index = 0; index < current.length; index += 1) expect(win.offset(index)).toBe(fresh.offset(index));
  }
});
