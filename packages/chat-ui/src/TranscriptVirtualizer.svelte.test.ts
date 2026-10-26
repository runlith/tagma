// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ChatTimelineItem, RowModel } from './timeline';
import { FeedMemory } from './FeedMemory';
import { TranscriptVirtualizer } from './TranscriptVirtualizer.svelte';

const VIEWPORT_PX = 600;
const ROW_ESTIMATE_PX = 60;

afterEach(() => document.body.replaceChildren());

function container(scrollHeight?: number): HTMLElement {
  const element = document.createElement('div');
  if (scrollHeight !== undefined) {
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
  }
  Object.defineProperty(element, 'clientHeight', { value: VIEWPORT_PX, configurable: true });
  Object.defineProperty(element, 'offsetHeight', { value: VIEWPORT_PX, configurable: true });
  Object.defineProperty(element, 'offsetWidth', { value: 800, configurable: true });
  element.getBoundingClientRect = () =>
    ({ width: 800, height: VIEWPORT_PX, top: 0, left: 0, right: 800, bottom: VIEWPORT_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  element.scrollTo = ((options: ScrollToOptions) => {
    if (typeof options?.top === 'number') element.scrollTop = options.top;
  }) as HTMLElement['scrollTo'];
  document.body.append(element);
  return element;
}

function list(): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({ width: 800, height: 0, top: 0, left: 0, right: 800, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.append(element);
  return element;
}

function rows(ids: readonly string[]): ChatTimelineItem[] {
  return ids.map(
    (id) =>
      ({
        kind: 'entry',
        key: id,
        entry: { kind: 'assistant', id, text: id },
      }) as unknown as ChatTimelineItem,
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
  node.getBoundingClientRect = () =>
    ({ width: 800, height, top: 0, left: 0, right: 800, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  host.append(node);
  return node;
}

function scrollTo(root: HTMLElement, top: number): void {
  root.scrollTop = top;
  root.dispatchEvent(new Event('scroll'));
}

function paint(root: HTMLElement, virtualizer: TranscriptVirtualizer): void {
  for (const node of [...root.querySelectorAll('[data-timeline-key]')]) node.remove();
  for (const row of virtualizer.rows) {
    const node = document.createElement('div');
    node.dataset.timelineKey = String(row.key);
    const top = row.start - virtualizer.margin;
    node.getBoundingClientRect = () => {
      const y = top - root.scrollTop;
      return { width: 800, height: row.size, top: y, bottom: y + row.size, left: 0, right: 800, x: 0, y, toJSON: () => ({}) } as DOMRect;
    };
    root.append(node);
  }
}

function screenTop(root: HTMLElement, key: string): number | undefined {
  const node = [...root.querySelectorAll<HTMLElement>('[data-timeline-key]')].find((candidate) => candidate.dataset.timelineKey === key);
  return node?.getBoundingClientRect().top;
}

function frame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

describe('where the mounted window opens', () => {
  test('a thread opens at its END, not at its first row', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const items = rows(numbered(0, 200));
    virtualizer.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });

    const keys = mounted(virtualizer);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain('row-199');
    expect(keys).not.toContain('row-0');
    virtualizer.dispose();
  });

  test('a thread opened away from the tail starts at its first row', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const items = rows(numbered(0, 200));
    virtualizer.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });

    const keys = mounted(virtualizer);
    expect(keys).toContain('row-0');
    expect(keys).not.toContain('row-199');
    virtualizer.dispose();
  });

  test('a thread with nothing in it mounts nothing and does not fall over', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    virtualizer.sync({
      root: container(),
      list: list(),
      model: modelOf([]),
      shape: shapeOf([]),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    expect(mounted(virtualizer)).toEqual([]);
    expect(virtualizer.totalSize).toBe(0);
    virtualizer.dispose();
  });
});

describe('where the window believes the feed ends', () => {
  test('the space below the last row is part of what the window reserves', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const items = rows(numbered(0, 10));
    virtualizer.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const bare = virtualizer.totalSize;
    virtualizer.dispose();

    const withComposer = new TranscriptVirtualizer(new FeedMemory());
    withComposer.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 220,
      disclosure: 0,
    });

    expect(bare).toBe(10 * ROW_ESTIMATE_PX);
    expect(withComposer.totalSize).toBe(bare + 220);
    withComposer.dispose();
  });
});

describe('putting the feed at its end', () => {
  test.each([true, false])('a changing timeline preserves follow intent: %s', async (following) => {
    vi.useFakeTimers();
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    Object.defineProperty(root, 'scrollHeight', {
      get: () => Number.parseFloat(held.style.height) || 0,
      configurable: true,
    });
    const items = rows(['message', 'work', 'thought', 'live']).map((row) => ({ ...row, estimate: 400 }));
    let atTail = true;
    const input = { root, list: held, atBottom: () => atTail, clearance: 220, disclosure: 0 };
    try {
      virtualizer.sync({ ...input, model: modelOf(items), shape: shapeOf(items) });
      await vi.advanceTimersByTimeAsync(16);
      virtualizer.anchorEnd();
      scrollTo(root, root.scrollHeight - VIEWPORT_PX);
      atTail = following;
      if (!following) scrollTo(root, 400);

      const answer = rows(['answer']).map((row) => ({ ...row, estimate: 80 }));
      const answered = [...items.slice(0, -1), ...answer, items.at(-1)!];
      virtualizer.sync({ ...input, model: modelOf(answered), shape: shapeOf(answered) });
      held.style.height = `${virtualizer.totalSize}px`;
      expect(root.scrollTop).toBe(following ? root.scrollHeight - VIEWPORT_PX : 400);
      await vi.advanceTimersByTimeAsync(16);
      expect(root.scrollTop).toBe(following ? root.scrollHeight - VIEWPORT_PX : 400);

      const trimmed = [items[0]!, ...answer, items.at(-1)!];
      virtualizer.sync({ ...input, model: modelOf(trimmed), shape: shapeOf(trimmed) });
      held.style.height = `${virtualizer.totalSize}px`;
      await vi.advanceTimersByTimeAsync(16);
      expect(root.scrollTop).toBe(following ? root.scrollHeight - VIEWPORT_PX : 400);
    } finally {
      virtualizer.dispose();
      root.remove();
      held.remove();
      vi.useRealTimers();
    }
  });

  test('the feed lands on the element own end', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container(12_000);
    virtualizer.sync({
      root,
      list: list(),
      model: modelOf(rows(numbered(0, 200))),
      shape: shapeOf(rows(numbered(0, 200))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });

    virtualizer.anchorEnd();

    expect(root.scrollTop).toBe(12_000 - VIEWPORT_PX);
    virtualizer.dispose();
  });

  test('anchoring the end drops the anchor holding the head', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container(12_000);
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(50, 150))),
      shape: shapeOf(rows(numbered(50, 150))),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    scrollTo(root, 120);
    await settled();
    paint(root, virtualizer);
    virtualizer.holdPrepend();

    virtualizer.anchorEnd();
    const landed = root.scrollTop;
    virtualizer.releasePrepend();
    await frame();

    expect(landed).toBe(12_000 - VIEWPORT_PX);
    expect(root.scrollTop).toBe(landed);
    virtualizer.dispose();
  });

  test('a feed with no rows is left alone', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container(12_000);
    virtualizer.sync({ root, list: list(), model: modelOf([]), shape: shapeOf([]), atBottom: () => true, clearance: 0, disclosure: 0 });
    root.scrollTop = 0;

    virtualizer.anchorEnd();

    expect(root.scrollTop).toBe(0);
    virtualizer.dispose();
  });

  async function measuredWhileAnchored(gesturing: () => boolean): Promise<HTMLElement> {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory(), { gesturing });
    const root = container(12_000);
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 100))),
      shape: shapeOf(rows(numbered(0, 100))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    await frame();
    scrollTo(root, 1000);
    await settled();

    virtualizer.measureRow(measured(held, 'row-0', 60 + 400));
    await frame();
    virtualizer.dispose();
    return root;
  }

  test('a row measuring while the feed is anchored re-aims it at the end', async () => {
    const root = await measuredWhileAnchored(() => false);
    expect(root.scrollTop).toBe(12_000 - VIEWPORT_PX);
  });

  test('a row measuring under the reader hand does not re-aim the feed', async () => {
    const root = await measuredWhileAnchored(() => true);
    expect(root.scrollTop).toBe(1000);
  });
});

describe('a reader who leaves the tail while the feed is streaming', () => {
  test('growth below a paused reader inside the end tolerance preserves their position', async () => {
    const root = container(12_000);
    const held = list();
    let atTail = true;
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 200))),
      shape: shapeOf(rows(numbered(0, 200))),
      atBottom: () => atTail,
      clearance: 0,
      disclosure: 0,
    });
    virtualizer.anchorEnd();
    atTail = false;
    scrollTo(root, 11_399);
    await settled();

    virtualizer.measureRow(measured(held, 'row-199', 460));
    await frame();

    expect(virtualizer.totalSize).toBe(12_400);
    expect(root.scrollTop).toBe(11_399);

    virtualizer.measureRow(measured(held, 'row-180', 260));
    await frame();
    expect(root.scrollTop).toBe(11_599);
    virtualizer.dispose();
  });

  test('growth after the reader leaves the tail does not drag them back to it', async () => {
    let height = 12_000;
    const root = container();
    Object.defineProperty(root, 'scrollHeight', { get: () => height, configurable: true });
    const held = list();
    let atTail = true;
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 200))),
      shape: shapeOf(rows(numbered(0, 200))),
      atBottom: () => atTail,
      clearance: 0,
      disclosure: 0,
    });
    virtualizer.anchorEnd();
    expect(root.scrollTop).toBe(height - VIEWPORT_PX);

    atTail = false;
    scrollTo(root, 4_000);

    height += 800;
    await frame();
    height += 800;
    await frame();

    expect(root.scrollTop).toBe(4_000);
    virtualizer.dispose();
  });

  test('a page landing at the head still carries the reader down after the feed rode its tail', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container(12_000);
    const held = list();
    let atTail = true;
    const items = { root, list: held, atBottom: () => atTail, clearance: 0, disclosure: 0 };
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(50, 150))), shape: shapeOf(rows(numbered(50, 150))) });
    virtualizer.anchorEnd();
    atTail = false;
    scrollTo(root, 120);
    await settled();

    virtualizer.sync({ ...items, model: modelOf(rows(numbered(0, 150))), shape: shapeOf(rows(numbered(0, 150))) });

    expect(root.scrollTop).toBe(120 + 50 * ROW_ESTIMATE_PX);
    virtualizer.dispose();
  });

  test('the reader who stayed at the tail is carried by the growth', async () => {
    let height = 12_000;
    const root = container();
    Object.defineProperty(root, 'scrollHeight', { get: () => height, configurable: true });
    const held = list();
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 200))),
      shape: shapeOf(rows(numbered(0, 200))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    virtualizer.anchorEnd();

    height += 800;
    await frame();

    expect(root.scrollTop).toBe(height - VIEWPORT_PX);
    virtualizer.dispose();
  });
});

describe('what a page landing at the head does to the window', () => {
  test('older rows arriving above the reader leave the mounted rows where they were', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(50, 100))),
      shape: shapeOf(rows(numbered(50, 100))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const before = mounted(virtualizer);
    expect(before).toContain('row-99');

    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 100))),
      shape: shapeOf(rows(numbered(0, 100))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const after = mounted(virtualizer);

    for (const key of before) expect(after).toContain(key);
    expect(after).not.toContain('row-0');
    virtualizer.dispose();
  });

  test('a page landing above carries the reader down by what it brought', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = { root, list: held, atBottom: () => false, clearance: 0, disclosure: 0 };
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(50, 150))), shape: shapeOf(rows(numbered(50, 150))) });
    scrollTo(root, 120);
    await settled();

    virtualizer.sync({ ...items, model: modelOf(rows(numbered(0, 150))), shape: shapeOf(rows(numbered(0, 150))) });

    expect(root.scrollTop).toBe(120 + 50 * ROW_ESTIMATE_PX);
    virtualizer.dispose();
  });

  test('the row the reader was on stays exactly where it was on screen', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = { root, list: held, atBottom: () => false, clearance: 0, disclosure: 0 };
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(50, 150))), shape: shapeOf(rows(numbered(50, 150))) });
    scrollTo(root, 120);
    await settled();
    paint(root, virtualizer);
    const before = screenTop(root, 'row-52');
    expect(before).toBe(0);

    virtualizer.holdPrepend();
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(0, 150))), shape: shapeOf(rows(numbered(0, 150))) });
    paint(root, virtualizer);
    virtualizer.releasePrepend();
    await frame();

    expect(screenTop(root, 'row-52')).toBe(before);
    virtualizer.dispose();
  });

  test('rows removed above the reader under the keyed anchor leave their row where it was', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = { root, list: held, atBottom: () => false, clearance: 0, disclosure: 0 };
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(0, 150))), shape: shapeOf(rows(numbered(0, 150))) });
    scrollTo(root, 120);
    await settled();
    paint(root, virtualizer);
    const before = screenTop(root, 'row-2');
    expect(before).toBe(0);

    virtualizer.holdPrepend();
    virtualizer.sync({ ...items, model: modelOf(rows(numbered(2, 150))), shape: shapeOf(rows(numbered(2, 150))) });
    paint(root, virtualizer);
    virtualizer.releasePrepend();
    await frame();

    expect(screenTop(root, 'row-2')).toBe(before);
    virtualizer.dispose();
  });

  test('a row appended at the tail keeps the reader on the tail', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 40))),
      shape: shapeOf(rows(numbered(0, 40))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    expect(mounted(virtualizer)).toContain('row-39');

    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 41))),
      shape: shapeOf(rows(numbered(0, 41))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    expect(mounted(virtualizer)).toContain('row-40');
    virtualizer.dispose();
  });
});

describe('what the reader can see', () => {
  test('the visible keys are the rows inside the viewport, not the mounted overscan', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 100))),
      shape: shapeOf(rows(numbered(0, 100))),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    await frame();

    const visible = virtualizer.visibleKeys;
    expect(visible[0]).toBe('row-0');
    expect(visible.length).toBe(VIEWPORT_PX / ROW_ESTIMATE_PX);
    expect(mounted(virtualizer).length).toBeGreaterThan(visible.length);
    for (const key of visible) expect(mounted(virtualizer)).toContain(key);

    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 100))),
      shape: shapeOf(rows(numbered(0, 100))),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    expect(virtualizer.visibleKeys).toBe(visible);

    scrollTo(root, 600);
    await settled();
    expect(virtualizer.visibleKeys[0]).toBe('row-10');
    virtualizer.dispose();
  });
});

describe('what the first paint costs', () => {
  test('the opening window is smaller than the one the reader scrolls in', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const items = rows(numbered(0, 200));
    virtualizer.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const opening = virtualizer.rows.length;

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(virtualizer.rows.length).toBeGreaterThan(opening);
    expect(mounted(virtualizer)).toContain('row-199');
    virtualizer.dispose();
  });
});

describe('which rows may move the reader when they turn out taller', () => {
  test('the row under the reader eye does not move them when it measures', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 400))),
      shape: shapeOf(rows(numbered(0, 400))),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    scrollTo(root, 3030);
    await settled();

    const spanning = virtualizer.rows.find((row) => row.start < 3030 && row.end > 3030);
    expect(spanning).toBeDefined();
    const before = root.scrollTop;
    const total = virtualizer.totalSize;
    virtualizer.measureRow(measured(held, String(spanning?.key), 60 + 500));
    await frame();

    expect(virtualizer.totalSize - total).toBe(500);
    expect(root.scrollTop).toBe(before);
    virtualizer.dispose();
  });

  test('a row entirely above the fold moves the scroll by what it grew', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 400))),
      shape: shapeOf(rows(numbered(0, 400))),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    scrollTo(root, 3000);
    await settled();

    const above = virtualizer.rows.find((row) => row.end <= 3000);
    expect(above).toBeDefined();
    const before = root.scrollTop;
    const total = virtualizer.totalSize;
    virtualizer.measureRow(measured(held, String(above?.key), 60 + 500));
    await frame();

    expect(virtualizer.totalSize - total).toBe(500);
    expect(root.scrollTop - before).toBe(500);
    virtualizer.dispose();
  });

  test('a measuring row asks where the reader is NOW, not where they were at the last sync', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    let atTail = true;
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 400))),
      shape: shapeOf(rows(numbered(0, 400))),
      atBottom: () => atTail,
      clearance: 0,
      disclosure: 0,
    });
    await frame();

    atTail = false;
    scrollTo(root, 3000);
    await settled();

    const above = virtualizer.rows.find((row) => row.end <= 3000);
    expect(above).toBeDefined();
    const before = root.scrollTop;
    virtualizer.measureRow(measured(held, String(above?.key), 60 + 500));
    await frame();

    expect(root.scrollTop - before).toBe(500);
    virtualizer.dispose();
  });

  test('a reader at the tail stays at the tail when a row grows', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(rows(numbered(0, 100))),
      shape: shapeOf(rows(numbered(0, 100))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    await frame();
    const grown = virtualizer.rows.at(-1);
    expect(grown).toBeDefined();

    const totalBefore = virtualizer.totalSize;
    virtualizer.measureRow(measured(held, String(grown?.key), 60 + 400));
    await frame();

    expect(virtualizer.totalSize).toBe(totalBefore + 400);
    expect(mounted(virtualizer)).toContain('row-99');
    virtualizer.dispose();
  });
});

describe('what the window remembers between threads', () => {
  test('a thread re-entered keeps the heights it measured', () => {
    const memory = new FeedMemory();
    const first = new TranscriptVirtualizer(memory);
    const root = container();
    const held = list();
    const items = rows(numbered(0, 30));
    first.openThread('thread-6');
    first.sync({ root, list: held, model: modelOf(items), shape: shapeOf(items), atBottom: () => true, clearance: 0, disclosure: 0 });
    const measured = first.totalSize;
    const node = document.createElement('div');
    node.dataset.timelineKey = 'row-0';
    Object.defineProperty(node, 'offsetHeight', { value: 400, configurable: true });
    node.getBoundingClientRect = () =>
      ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    held.append(node);
    first.measureRow(node);
    const grown = first.totalSize;
    expect(grown).toBeGreaterThan(measured);
    first.dispose();

    const again = new TranscriptVirtualizer(memory);
    again.openThread('thread-6');
    again.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    expect(again.totalSize).toBe(grown);
    again.dispose();
  });

  test('a thread opened after another one starts from its own measurements', () => {
    const held = new TranscriptVirtualizer(new FeedMemory());
    const items = rows(numbered(0, 30));
    held.openThread('thread-a');
    held.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const estimated = held.totalSize;
    held.measureRow(measured(document.body, 'row-0', 400));
    expect(held.totalSize).toBeGreaterThan(estimated);

    held.openThread('thread-b');
    held.sync({
      root: container(),
      list: list(),
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });

    expect(held.totalSize).toBe(estimated);
    held.dispose();
  });
});

describe('whose height a mounted row gives', () => {
  test('rows landing above, before the screen caught up, leave every height with its own row', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const input = { root, list: list(), atBottom: () => true, clearance: 0 };
    const items = rows(numbered(0, 8));
    virtualizer.sync({ ...input, model: modelOf(items), shape: shapeOf(items), disclosure: 0 });
    for (const key of numbered(0, 8)) virtualizer.measureRow(measured(root, key, 100));

    const grown = rows(['fresh', ...numbered(0, 8)]);
    virtualizer.sync({ ...input, model: modelOf(grown), shape: shapeOf(grown), disclosure: 1 });

    expect(virtualizer.totalSize).toBe(8 * 100 + ROW_ESTIMATE_PX);
    virtualizer.dispose();
  });

  test('a window rebuilt over rows already on screen takes their heights from the screen', () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const items = rows(numbered(0, 8));
    const input = { root, list: list(), model: modelOf(items), shape: shapeOf(items), atBottom: () => true, clearance: 0, disclosure: 0 };
    virtualizer.sync(input);
    for (const key of numbered(0, 8)) virtualizer.measureRow(measured(root, key, 100));

    virtualizer.openThread('born');
    virtualizer.sync(input);

    expect(virtualizer.totalSize).toBe(8 * 100);
    virtualizer.dispose();
  });
});

describe('a row whose body arrives after it was measured', () => {
  test('the window reads the named row again, at the height its body gave it', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    virtualizer.sync({
      root,
      list: list(),
      model: modelOf(rows(numbered(0, 12))),
      shape: shapeOf(rows(numbered(0, 12))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const estimated = virtualizer.totalSize;

    measured(root, 'row-3', 300);

    virtualizer.measureRowLater('row-3');
    await frame();

    expect(virtualizer.totalSize).toBe(estimated - ROW_ESTIMATE_PX + 300);
    virtualizer.dispose();
  });

  test('a row reporting several times is read once', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    virtualizer.sync({
      root,
      list: list(),
      model: modelOf(rows(numbered(0, 12))),
      shape: shapeOf(rows(numbered(0, 12))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });

    measured(root, 'row-3', 300);
    let reads = 0;
    const read = virtualizer.measureRow.bind(virtualizer);
    virtualizer.measureRow = (node) => {
      reads += 1;
      read(node);
    };

    virtualizer.measureRowLater('row-3');
    virtualizer.measureRowLater('row-3');
    virtualizer.measureRowLater('row-3');
    await frame();

    expect(reads).toBe(1);
    virtualizer.dispose();
  });

  test('a row that left the window before its body landed is not read', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    virtualizer.sync({
      root,
      list: list(),
      model: modelOf(rows(numbered(0, 12))),
      shape: shapeOf(rows(numbered(0, 12))),
      atBottom: () => true,
      clearance: 0,
      disclosure: 0,
    });
    const estimated = virtualizer.totalSize;

    virtualizer.measureRowLater('row-3');
    await frame();

    expect(virtualizer.totalSize).toBe(estimated);
    virtualizer.dispose();
  });
});

describe('rows kept alive past the window', () => {
  const alive = (ids: readonly string[], live: readonly string[]): ChatTimelineItem[] =>
    rows(ids).map((item) => (live.includes(item.key) ? ({ ...item, keepAlive: true } as ChatTimelineItem) : item));

  async function openAt(
    virtualizer: TranscriptVirtualizer,
    items: readonly ChatTimelineItem[],
    root: HTMLElement,
    held: HTMLElement,
    row: number,
  ) {
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(items),
      shape: shapeOf(items),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });
    scrollTo(root, row * ROW_ESTIMATE_PX);
    await frame();
  }

  test('a live row that was mounted stays mounted and inert after the window moves away, and a plain row does not', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = alive(numbered(0, 200), ['row-12']);
    await openAt(virtualizer, items, root, held, 10);
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
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const items = alive(numbered(0, 200), ['row-30']);
    await openAt(virtualizer, items, container(), list(), 100);

    expect(mounted(virtualizer)).not.toContain('row-30');
    virtualizer.dispose();
  });

  test('past four held rows the one out of sight the longest is let go', async () => {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const live = ['row-12', 'row-42', 'row-72', 'row-102', 'row-132'];
    const items = alive(numbered(0, 200), live);
    await openAt(virtualizer, items, root, held, 10);
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
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = alive(numbered(0, 200), ['row-12']);
    await openAt(virtualizer, items, root, held, 10);
    scrollTo(root, 150 * ROW_ESTIMATE_PX);
    await frame();

    const without = items.filter((item) => item.key !== 'row-12');
    virtualizer.sync({
      root,
      list: held,
      model: modelOf(without),
      shape: shapeOf(without),
      atBottom: () => false,
      clearance: 0,
      disclosure: 0,
    });

    expect(mounted(virtualizer)).not.toContain('row-12');
    expect(virtualizer.heldKeys.size).toBe(0);
    virtualizer.dispose();
  });
});

describe('a measured row that no longer fits the feed it was measured in', () => {
  function measuredFeed() {
    const virtualizer = new TranscriptVirtualizer(new FeedMemory());
    const root = container();
    const held = list();
    const items = rows(numbered(0, 30));
    const input = { root, list: held, shape: shapeOf(items), atBottom: () => true, clearance: 0 };
    virtualizer.sync({ ...input, model: modelOf(items), disclosure: 0 });
    const estimated = virtualizer.totalSize;
    virtualizer.measureRow(measured(document.body, 'row-0', 400));
    expect(virtualizer.totalSize).toBeGreaterThan(estimated);
    return { virtualizer, root, input, items, estimated };
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
      const { virtualizer, root, input, items, estimated } = measuredFeed();

      Object.defineProperty(root, 'clientWidth', { value: 500, configurable: true });
      for (const watcher of watchers)
        if (watcher.targets.has(root)) watcher.changed([{ target: root } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      virtualizer.sync({ ...input, model: modelOf(items), disclosure: 0 });

      expect(virtualizer.totalSize).toBe(estimated);
      virtualizer.dispose();
    } finally {
      view.ResizeObserver = standing;
    }
  });

  test('a row outside the window is estimated again once its disclosure changed', () => {
    const { virtualizer, input, items, estimated } = measuredFeed();

    const toggled = items.map((item, index) => (index === 0 ? ({ ...item, open: true } as ChatTimelineItem) : item));
    virtualizer.sync({ ...input, model: modelOf(toggled), disclosure: 1 });

    expect(virtualizer.totalSize).toBe(estimated);
    virtualizer.dispose();
  });

  test('a row left as it was keeps its measurement when only the disclosure counter moved', () => {
    const { virtualizer, input, items } = measuredFeed();
    const measuredSize = virtualizer.totalSize;

    virtualizer.sync({ ...input, model: modelOf(items), disclosure: 1 });

    expect(virtualizer.totalSize).toBe(measuredSize);
    virtualizer.dispose();
  });
});
