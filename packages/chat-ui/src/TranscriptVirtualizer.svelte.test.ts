// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChatTimelineItem, RowModel } from './timeline';
import { FeedMemory } from './FeedMemory';
import { TranscriptVirtualizer } from './TranscriptVirtualizer.svelte';

const VIEWPORT_PX = 600;
const ROW_ESTIMATE_PX = 60;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function container(): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { value: VIEWPORT_PX, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: 800, configurable: true });
  element.getBoundingClientRect = () =>
    ({ width: 800, height: VIEWPORT_PX, top: 0, left: 0, right: 800, bottom: VIEWPORT_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  element.scrollTo = ((options: ScrollToOptions) => {
    if (typeof options?.top === 'number') element.scrollTop = options.top;
  }) as HTMLElement['scrollTo'];
  document.body.append(element);
  return element;
}

function list(root: HTMLElement): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 768, configurable: true });
  element.getBoundingClientRect = () =>
    ({ width: 768, height: 0, top: -root.scrollTop, left: 0, right: 768, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(element.style.height) || 0, configurable: true });
  root.append(element);
  return element;
}

const total = (held: HTMLElement): number => Number.parseFloat(held.style.height) || 0;

function rows(ids: readonly string[]): ChatTimelineItem[] {
  return ids.map(
    (id) =>
      ({ kind: 'entry', key: id, entry: { kind: 'assistant', id, text: id }, estimate: ROW_ESTIMATE_PX }) as unknown as ChatTimelineItem,
  );
}

const shapeOf = (items: readonly ChatTimelineItem[]): number => {
  let hash = items.length;
  for (const item of items) for (let at = 0; at < item.key.length; at += 1) hash = (hash * 31 + item.key.charCodeAt(at)) | 0;
  return hash;
};

function modelOf(items: readonly ChatTimelineItem[]): RowModel {
  return {
    revision: 0,
    shape: shapeOf(items),
    count: items.length,
    keyAt: (index) => items[index]?.key,
    itemAt: (index) => items[index],
    item: (key) => items.find((item) => item.key === key),
    indexOf: (key) => items.findIndex((item) => item.key === key),
  };
}

const numbered = (from: number, to: number) => Array.from({ length: to - from }, (_unused, index) => `row-${from + index}`);

function mounted(virtualizer: TranscriptVirtualizer): string[] {
  return virtualizer.rows.map((row) => String(row.key));
}

function measured(host: HTMLElement, key: string, height: number): HTMLElement {
  const node = document.createElement('div');
  node.dataset.timelineKey = key;
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  host.append(node);
  return node;
}

function scrollTo(root: HTMLElement, top: number): void {
  root.scrollTop = top;
  root.dispatchEvent(new Event('scroll'));
}

async function frame(): Promise<void> {
  vi.advanceTimersToNextFrame();
  vi.advanceTimersToNextFrame();
  await Promise.resolve();
}

function opened(
  items: readonly ChatTimelineItem[],
  options: { thread?: string; tail?: boolean; clearance?: number; memory?: FeedMemory } = {},
) {
  const virtualizer = new TranscriptVirtualizer(options.memory ?? new FeedMemory());
  if (options.thread !== undefined) virtualizer.openThread(options.thread);
  if (options.tail === false) virtualizer.keepEnd(false);
  const root = container();
  const held = list(root);
  const input = { root, list: held, clearance: options.clearance ?? 0 };
  const sync = (next: readonly ChatTimelineItem[], disclosure = 0) =>
    virtualizer.sync({ ...input, model: modelOf(next), shape: shapeOf(next), disclosure });
  sync(items);
  return { virtualizer, root, held, sync };
}

describe('where the mounted window opens', () => {
  test('a thread opens at its end, and one opened away from the tail at its first row', () => {
    const items = rows(numbered(0, 200));
    const tail = opened(items);
    expect(mounted(tail.virtualizer)).toContain('row-199');
    expect(mounted(tail.virtualizer)).not.toContain('row-0');
    tail.virtualizer.dispose();

    const head = opened(items, { tail: false });
    expect(mounted(head.virtualizer)).toContain('row-0');
    expect(mounted(head.virtualizer)).not.toContain('row-199');
    head.virtualizer.dispose();
  });

  test('rows below the screen measured shorter extend the window to a screen of content past it', () => {
    const { virtualizer, root } = opened(rows(numbered(0, 200)), { tail: false });
    expect(mounted(virtualizer).at(-1)).toBe('row-19');

    for (const key of numbered(10, 20)) virtualizer.measureRow(measured(root, key, 6));

    expect(mounted(virtualizer).at(-1)).toBe('row-28');
    virtualizer.dispose();
  });

  test('a far select mounts the rows it glides through and lands on before the scroll is read back, and none behind them', () => {
    const { virtualizer } = opened(rows(numbered(0, 200)), { tail: false });

    virtualizer.scrollToRow('row-150', 'smooth');

    expect(mounted(virtualizer)).toEqual(expect.arrayContaining(['row-140', 'row-150', 'row-159']));
    expect(mounted(virtualizer)).not.toContain('row-130');
    virtualizer.dispose();
  });

  test('in motion every row in view mounts at once and the margin beyond it fills one row a frame, nearest first', () => {
    const { virtualizer, root } = opened(rows(numbered(0, 200)), { tail: false });

    scrollTo(root, 50 * ROW_ESTIMATE_PX);

    const inView = numbered(50, 60);
    const margin = () => mounted(virtualizer).filter((key) => !inView.includes(key) && !numbered(0, 20).includes(key));
    expect(mounted(virtualizer)).toEqual(expect.arrayContaining(inView));
    expect(margin()).toEqual(['row-49']);
    virtualizer.measureRow(measured(root, 'row-49', 6));
    expect(margin()).toEqual(['row-49']);
    vi.advanceTimersToNextFrame();
    expect(margin()).toEqual(['row-49', 'row-60']);
    vi.advanceTimersToNextFrame();
    expect(margin()).toEqual(['row-48', 'row-49', 'row-60']);
    virtualizer.dispose();
  });

  test('the space below the last row is part of what the window reserves', () => {
    const items = rows(numbered(0, 10));
    const bare = opened(items);
    const withComposer = opened(items, { clearance: 220 });

    expect(total(bare.held)).toBe(10 * ROW_ESTIMATE_PX);
    expect(total(withComposer.held)).toBe(10 * ROW_ESTIMATE_PX + 220);
  });
});

describe('what the window remembers between threads', () => {
  test('a thread re-entered keeps the heights it measured, and another thread starts from its own', () => {
    const memory = new FeedMemory();
    const items = rows(numbered(0, 30));
    const first = opened(items, { thread: 'thread-6', memory });
    const estimated = total(first.held);
    const node = measured(first.held, 'row-0', 400);
    first.virtualizer.measureRow(node);
    const grown = total(first.held);
    expect(grown).toBe(estimated - ROW_ESTIMATE_PX + 400);
    node.remove();
    first.virtualizer.openThread('thread-7');
    first.sync(items);
    expect(total(first.held)).toBe(estimated);
    first.virtualizer.dispose();

    const again = opened(items, { thread: 'thread-6', memory });
    expect(total(again.held)).toBe(grown);
    again.virtualizer.dispose();
  });
});

describe('whose height a mounted row gives', () => {
  test('rows landing above, before the screen caught up, leave every height with its own row', () => {
    const { virtualizer, root, held, sync } = opened(rows(numbered(0, 8)));
    for (const key of numbered(0, 8)) virtualizer.measureRow(measured(root, key, 100));

    sync(rows(['fresh', ...numbered(0, 8)]), 1);

    expect(total(held)).toBe(8 * 100 + ROW_ESTIMATE_PX);
    virtualizer.dispose();
  });

  test('a row measured at exactly its estimate keeps that height when a disclosure re-estimates it, until its observer reports', () => {
    const items = rows(numbered(0, 30));
    const { virtualizer, root, held, sync } = opened(items);
    virtualizer.measureRow(measured(document.body, 'row-0', 400));
    const node = measured(root, 'row-29', ROW_ESTIMATE_PX);
    virtualizer.measureRow(node);
    Object.defineProperty(node, 'offsetHeight', { value: 250, configurable: true });

    sync(
      items.map((item) =>
        item.key === 'row-29'
          ? ({ ...item, open: true, estimate: 258 } as ChatTimelineItem)
          : item.key === 'row-0'
            ? ({ ...item, open: true, estimate: 200 } as ChatTimelineItem)
            : item,
      ),
      1,
    );

    expect(total(held)).toBe(28 * ROW_ESTIMATE_PX + 200 + ROW_ESTIMATE_PX);
    virtualizer.dispose();
  });
});

describe('rows kept alive past the window', () => {
  const alive = (ids: readonly string[], live: readonly string[]): ChatTimelineItem[] =>
    rows(ids).map((item) => (live.includes(item.key) ? ({ ...item, keepAlive: true } as ChatTimelineItem) : item));

  async function openAt(items: readonly ChatTimelineItem[], row: number) {
    const feed = opened(items, { tail: false });
    scrollTo(feed.root, row * ROW_ESTIMATE_PX);
    await frame();
    return feed;
  }

  test('a live row that was mounted stays mounted and inert after the window moves away, and a plain row does not', async () => {
    const { virtualizer, root } = await openAt(alive(numbered(0, 200), ['row-12']), 10);
    expect(mounted(virtualizer)).toContain('row-12');
    expect(virtualizer.heldKeys.has('row-12')).toBe(false);

    scrollTo(root, 150 * ROW_ESTIMATE_PX);
    await frame();

    expect(mounted(virtualizer)).toContain('row-12');
    expect(virtualizer.heldKeys.has('row-12')).toBe(true);
    expect(mounted(virtualizer)).not.toContain('row-11');
    virtualizer.dispose();
  });

  test('a live row that was never mounted is not mounted by being live', async () => {
    const { virtualizer } = await openAt(alive(numbered(0, 200), ['row-30']), 100);

    expect(mounted(virtualizer)).not.toContain('row-30');
    virtualizer.dispose();
  });

  test('past four held rows the one out of sight the longest is let go', async () => {
    const live = ['row-12', 'row-42', 'row-72', 'row-102', 'row-132'];
    const { virtualizer, root } = await openAt(alive(numbered(0, 200), live), 10);
    for (const row of [40, 70, 100, 130]) {
      scrollTo(root, row * ROW_ESTIMATE_PX);
      await frame();
    }
    expect(live.every((key) => mounted(virtualizer).includes(key))).toBe(true);

    scrollTo(root, 170 * ROW_ESTIMATE_PX);
    await frame();

    expect(mounted(virtualizer)).not.toContain('row-12');
    for (const key of live.slice(1)) expect(mounted(virtualizer)).toContain(key);
    virtualizer.dispose();
  });

  test('a live row that leaves the timeline is let go with its record', async () => {
    const items = alive(numbered(0, 200), ['row-12']);
    const { virtualizer, root, sync } = await openAt(items, 10);
    scrollTo(root, 150 * ROW_ESTIMATE_PX);
    await frame();

    sync(items.filter((item) => item.key !== 'row-12'));

    expect(mounted(virtualizer)).not.toContain('row-12');
    expect(virtualizer.heldKeys.size).toBe(0);
    virtualizer.dispose();
  });

  test('a row holding focus or a selection end stays mounted after the window moves away', async () => {
    const { virtualizer, root } = await openAt(rows(numbered(0, 200)), 10);
    virtualizer.keep(['row-12', 'row-12']);

    scrollTo(root, 150 * ROW_ESTIMATE_PX);
    await frame();

    expect(mounted(virtualizer).filter((key) => key === 'row-12')).toHaveLength(1);
    expect(virtualizer.heldKeys.has('row-12')).toBe(false);
    expect(mounted(virtualizer)).not.toContain('row-11');
    virtualizer.dispose();
  });
});

describe('a measured row that no longer fits the feed it was measured in', () => {
  function measuredFeed() {
    const items = rows(numbered(0, 30));
    const feed = opened(items);
    const estimated = total(feed.held);
    feed.virtualizer.measureRow(measured(document.body, 'row-0', 400));
    expect(total(feed.held)).toBe(estimated - ROW_ESTIMATE_PX + 400);
    return { ...feed, items, estimated };
  }

  test('a row outside the window is estimated again once the feed changes width', () => {
    const view = document.defaultView!;
    const standing = view.ResizeObserver;
    const watchers: { targets: Set<Element>; changed: ResizeObserverCallback }[] = [];
    view.ResizeObserver = class {
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
    try {
      const { virtualizer, root, held, sync, items, estimated } = measuredFeed();

      Object.defineProperty(held, 'clientWidth', { value: 480, configurable: true });
      for (const watcher of watchers)
        if (watcher.targets.has(root)) watcher.changed([{ target: root } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      sync(items);

      expect(total(held)).toBe(estimated);
      virtualizer.dispose();
    } finally {
      view.ResizeObserver = standing;
    }
  });

  test('a row outside the window is estimated again once its disclosure changed what it is worth', () => {
    const { virtualizer, held, sync, items, estimated } = measuredFeed();

    sync(
      items.map((item, index) => (index === 0 ? ({ ...item, open: true, estimate: 200 } as ChatTimelineItem) : item)),
      1,
    );

    expect(total(held)).toBe(estimated - ROW_ESTIMATE_PX + 200);
    virtualizer.dispose();
  });

  test('a row left as it was keeps its measurement when only the disclosure counter moved', () => {
    const { virtualizer, held, sync, items } = measuredFeed();
    const measuredSize = total(held);

    sync(items, 1);

    expect(total(held)).toBe(measuredSize);
    virtualizer.dispose();
  });
});
