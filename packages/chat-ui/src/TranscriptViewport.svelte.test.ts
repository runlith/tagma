// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FeedMemory } from './FeedMemory';
import type { ChatTimelineItem, RowModel } from './timeline';
import { TranscriptViewport } from './TranscriptViewport.svelte';

const VIEWPORT_PX = 600;
const ROW_PX = 60;
const FOOT_PX = 20;

type Watcher = { readonly targets: Set<Element>; readonly changed: ResizeObserverCallback; readonly observer: ResizeObserver };
type Row = { readonly outer: HTMLElement; readonly inner: HTMLElement; readonly release: () => void };

let standing: typeof ResizeObserver | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  standing = document.defaultView!.ResizeObserver;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.defaultView!.ResizeObserver = standing!;
  document.body.replaceChildren();
});

class Browser {
  readonly root = document.createElement('div');
  readonly list = document.createElement('div');
  readonly heights = new Map<string, number>();
  readonly rows = new Map<string, Row>();
  private width = 768;
  private readonly watchers: Watcher[] = [];
  private readonly fresh = new Set<Element>();
  private top = 0;
  private moved = false;

  constructor() {
    const browser = this;
    document.defaultView!.ResizeObserver = class {
      private readonly watcher: Watcher;
      constructor(changed: ResizeObserverCallback) {
        this.watcher = { targets: new Set(), changed, observer: this as unknown as ResizeObserver };
        browser.watchers.push(this.watcher);
      }
      observe(target: Element): void {
        this.watcher.targets.add(target);
        browser.fresh.add(target);
      }
      unobserve(target: Element): void {
        this.watcher.targets.delete(target);
      }
      disconnect(): void {
        this.watcher.targets.clear();
      }
    } as unknown as typeof ResizeObserver;
    const root = this.root;
    for (const name of ['clientHeight', 'offsetHeight'] as const) Object.defineProperty(root, name, { get: () => VIEWPORT_PX });
    for (const name of ['clientWidth', 'offsetWidth'] as const) Object.defineProperty(root, name, { get: () => 800 });
    Object.defineProperty(root, 'scrollHeight', { get: () => Number.parseFloat(this.list.style.height) || 0 });
    Object.defineProperty(root, 'scrollTop', {
      get: () => {
        const max = this.max();
        if (this.top > max) this.place(max);
        return this.top;
      },
      set: (value: number) => this.place(Math.min(this.max(), Math.max(0, Math.round(value * 2) / 2))),
    });
    root.scrollTo = ((options: ScrollToOptions) => {
      if (typeof options?.top === 'number') root.scrollTop = options.top;
    }) as HTMLElement['scrollTo'];
    root.getBoundingClientRect = () => rect(0, VIEWPORT_PX);
    Object.defineProperty(this.list, 'clientWidth', { get: () => this.width });
    this.list.getBoundingClientRect = () => rect(-this.top, 0);
    root.append(this.list);
    document.body.append(root);
  }

  paint(viewport: TranscriptViewport): void {
    const shown = new Set(viewport.window.rows.map((row) => String(row.key)));
    for (const [key, row] of this.rows) {
      if (shown.has(key)) continue;
      row.release();
      row.outer.remove();
      this.rows.delete(key);
    }
    for (const key of shown) {
      if (this.rows.has(key)) continue;
      const outer = document.createElement('div');
      const inner = document.createElement('div');
      inner.dataset.timelineKey = key;
      Object.defineProperty(inner, 'offsetHeight', { get: () => this.heightOf(key) });
      inner.getBoundingClientRect = () => rect((Number.parseFloat(outer.style.top) || 0) - this.top, this.heightOf(key));
      outer.append(inner);
      this.list.append(outer);
      this.rows.set(key, { outer, inner, release: viewport.window.box(key, outer) });
      viewport.window.measureRow(inner);
    }
  }

  async frame(viewport: TranscriptViewport): Promise<void> {
    if (this.moved) {
      this.moved = false;
      this.root.dispatchEvent(new Event('scroll'));
    }
    vi.advanceTimersToNextFrame();
    this.observe([...this.fresh]);
    this.fresh.clear();
    this.paint(viewport);
    await Promise.resolve();
  }

  async settle(viewport: TranscriptViewport): Promise<void> {
    for (let frame = 0; frame < 6; frame += 1) await this.frame(viewport);
    vi.advanceTimersByTime(200);
    for (let frame = 0; frame < 3; frame += 1) await this.frame(viewport);
  }

  resize(key: string, height: number): void {
    this.resizeAll([[key, height]]);
  }

  resizeAll(sizes: readonly (readonly [string, number])[]): void {
    for (const [key, height] of sizes) this.heights.set(key, height);
    this.observe(sizes.flatMap(([key]) => this.rows.get(key)?.inner ?? []));
  }

  widen(width: number): void {
    this.width = width;
    this.observe([this.root]);
  }

  wheel(delta: number): void {
    this.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta }));
    this.root.scrollTop = this.top + delta;
  }

  screenTop(key: string): number | undefined {
    const row = this.rows.get(key);
    return row === undefined ? undefined : Number.parseFloat(row.outer.style.top) - this.root.scrollTop;
  }

  topRow(): string {
    let found = '';
    let best = Number.NEGATIVE_INFINITY;
    for (const key of this.rows.keys()) {
      const top = this.screenTop(key)!;
      if (top <= 0 && top > best) {
        best = top;
        found = key;
      }
    }
    return found;
  }

  atEnd(): boolean {
    return this.root.scrollTop >= this.max() - 1;
  }

  heightOf(key: string): number {
    return this.heights.get(key) ?? ROW_PX;
  }

  private max(): number {
    return Math.max(0, (Number.parseFloat(this.list.style.height) || 0) - VIEWPORT_PX);
  }

  private place(top: number): void {
    if (top === this.top) return;
    this.top = top;
    this.moved = true;
  }

  private observe(targets: readonly Element[]): void {
    for (const watcher of this.watchers) {
      const entries = targets
        .filter((target) => watcher.targets.has(target))
        .map((target) => {
          const key = (target as HTMLElement).dataset.timelineKey;
          const height = key === undefined ? VIEWPORT_PX : this.heightOf(key);
          return {
            target,
            borderBoxSize: [{ blockSize: height, inlineSize: 768 }],
            contentRect: rect(0, height),
          } as unknown as ResizeObserverEntry;
        });
      if (entries.length > 0) watcher.changed(entries, watcher.observer);
    }
  }
}

function rect(top: number, height: number): DOMRect {
  return { width: 800, height, top, bottom: top + height, left: 0, right: 800, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function modelOf(keys: readonly string[], worth: ReadonlyMap<string, number> = new Map()): RowModel {
  const items = keys.map(
    (key) => ({ kind: 'entry', key, entry: { kind: 'user', id: key }, estimate: worth.get(key) ?? ROW_PX }) as unknown as ChatTimelineItem,
  );
  const at = new Map(keys.map((key, index) => [key, index]));
  return {
    revision: 0,
    shape: keys.length + (keys[0]?.length ?? 0),
    count: items.length,
    keyAt: (index) => items[index]?.key,
    itemAt: (index) => items[index],
    item: (key) => items[at.get(key) ?? -1],
    indexOf: (key) => at.get(key) ?? -1,
  };
}

const numbered = (from: number, to: number, prefix = 'row') =>
  Array.from({ length: to - from }, (_unused, index) => `${prefix}-${from + index}`);

async function opened(keys: readonly string[] = numbered(0, 200), messages: readonly string[] = []) {
  const browser = new Browser();
  const viewport = new TranscriptViewport(new FeedMemory());
  viewport.attach(browser.root);
  viewport.useMessages(() => messages.map((id) => ({ id })));
  let model = keys;
  let shape = 0;
  let disclosure = 0;
  const sync = (next: readonly string[] = model, worth?: ReadonlyMap<string, number>) => {
    if (next !== model) shape += 1;
    if (worth !== undefined) disclosure += 1;
    model = next;
    viewport.window.sync({ root: browser.root, list: browser.list, model: modelOf(next, worth), shape, clearance: 0, disclosure });
    browser.paint(viewport);
  };
  sync(keys);
  await browser.settle(viewport);
  const settle = () => browser.settle(viewport);
  const read = async (top: number) => {
    browser.wheel(top - browser.root.scrollTop || -1);
    await settle();
  };
  return { browser, viewport, sync, settle, read, keys: () => model };
}

describe('the tail', () => {
  test('the feed opens at its tail and keeps it while the last row grows and rows arrive', async () => {
    const { browser, viewport, sync, settle, keys } = await opened();
    expect(browser.atEnd()).toBe(true);

    browser.resize('row-199', 400);
    await settle();
    expect(browser.atEnd()).toBe(true);

    sync([...keys(), 'row-200', 'row-201']);
    await settle();
    expect(browser.atEnd()).toBe(true);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('a return to the tail keeps following when rows there grow before the feed reaches them', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    await read(3000);
    viewport.resume();
    await settle();
    expect(viewport.following).toBe(true);

    sync([...keys(), 'row-200']);
    browser.resize('row-196', 1060);
    await settle();

    expect(browser.atEnd()).toBe(true);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('a selection begun while the tail is still being reached holds the feed against later growth', async () => {
    const { browser, viewport, sync, settle, keys } = await opened();
    const text = document.createTextNode('an answer worth copying');
    browser.list.append(text);

    sync([...keys(), 'row-200']);
    const top = browser.root.scrollTop;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    viewport.syncSelection(window.getSelection(), browser.list);
    browser.resize('row-200', 400);
    await settle();

    expect(browser.root.scrollTop).toBe(top);
    window.getSelection()!.removeAllRanges();
    viewport.dispose();
  });

  test('a return to the tail ends the hold of the selection standing in the feed, and the next selection holds again', async () => {
    const { browser, viewport, settle } = await opened();
    const text = document.createTextNode('an answer still being written');
    browser.rows.get('row-199')!.inner.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    viewport.syncSelection(window.getSelection(), browser.list);
    expect(viewport.anchored).toBe(false);

    viewport.resume();
    text.appendData(' and more of it');
    viewport.syncSelection(window.getSelection(), browser.list);
    browser.resize('row-199', 400);
    await settle();
    expect(browser.atEnd()).toBe(true);
    expect(viewport.anchored).toBe(true);

    window.getSelection()!.removeAllRanges();
    viewport.syncSelection(window.getSelection(), browser.list);
    window.getSelection()!.addRange(range);
    viewport.syncSelection(window.getSelection(), browser.list);
    expect(viewport.anchored).toBe(false);
    window.getSelection()!.removeAllRanges();
    viewport.dispose();
  });

  test('a press holds the feed still while the tail grows, and an unmoved feed returns to the tail on release', async () => {
    const { browser, viewport, settle } = await opened();
    const top = browser.root.scrollTop;
    browser.root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));

    browser.resize('row-199', 400);
    await settle();
    expect(browser.root.scrollTop).toBe(top);

    window.dispatchEvent(new MouseEvent('pointerup'));
    await settle();
    expect(browser.atEnd()).toBe(true);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });
});

describe('a paused reader', () => {
  test('is never moved by what grows or arrives below them', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    await read(6000);
    expect(viewport.following).toBe(false);
    const anchor = browser.topRow();
    const seen = browser.screenTop(anchor)!;

    browser.resize('row-199', 500);
    sync([...keys(), 'row-200']);
    await settle();

    expect(browser.screenTop(anchor)! - seen).toBeCloseTo(0, 0);
    viewport.dispose();
  });

  test('keeps the row on screen in place while rows above measure taller and a page lands above', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    await read(6000);
    const anchor = browser.topRow();
    const seen = browser.screenTop(anchor)!;

    browser.resize('row-90', 300);
    await settle();
    expect(Math.abs(browser.screenTop(anchor)! - seen)).toBeLessThan(0.5);

    sync([...numbered(0, 50, 'older'), ...keys()]);
    await settle();
    expect(Math.abs(browser.screenTop(anchor)! - seen)).toBeLessThan(0.5);
    viewport.dispose();
  });

  test.each(['pointerup', 'pointercancel', 'blur'])(
    'a scroller press folds its correction once on %s and leaves no hold',
    async (release) => {
      const { browser, viewport, settle, read } = await opened(numbered(0, 30));
      await read(900);
      const top = browser.root.scrollTop;
      const anchor = browser.topRow();
      const seen = browser.screenTop(anchor)!;
      const range = browser.root.scrollHeight;
      browser.root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));

      browser.resize('row-10', 160);
      await settle();

      expect(browser.root.scrollTop).toBe(top);
      expect(browser.root.scrollHeight).toBe(range);
      expect(browser.screenTop(anchor)).toBe(seen);

      window.dispatchEvent(new MouseEvent(release));
      await settle();

      expect(browser.root.scrollTop).toBe(top + 100);
      expect(browser.root.scrollHeight).toBe(range + 100);
      expect(browser.screenTop(anchor)).toBe(seen);

      window.dispatchEvent(new MouseEvent(release));
      browser.resize('row-10', 260);
      await settle();

      expect(browser.root.scrollTop).toBe(top + 200);
      expect(browser.screenTop(anchor)).toBe(seen);
      viewport.dispose();
    },
  );

  test('a text-selection drag holds following but leaves measured corrections writable', async () => {
    const { browser, viewport, settle, read } = await opened(numbered(0, 30));
    await read(900);
    const top = browser.root.scrollTop;
    const anchor = browser.topRow();
    const seen = browser.screenTop(anchor)!;
    const row = browser.rows.get(anchor)!.inner;
    const text = document.createTextNode('selected content');
    row.append(text);
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    viewport.syncSelection(window.getSelection(), browser.list);

    browser.resize('row-10', 160);
    await settle();

    expect(browser.root.scrollTop).toBe(top + 100);
    expect(browser.screenTop(anchor)).toBe(seen);
    expect(viewport.anchored).toBe(false);

    window.dispatchEvent(new MouseEvent('pointerup'));
    window.getSelection()!.removeAllRanges();
    viewport.syncSelection(window.getSelection(), browser.list);
    browser.resize('row-10', 260);
    await settle();

    expect(browser.root.scrollTop).toBe(top + 200);
    expect(browser.screenTop(anchor)).toBe(seen);
    viewport.dispose();
  });

  test('a control the reader pressed stays where it was when its row opens above or below it', async () => {
    const { browser, viewport, sync, settle, read } = await opened();
    await read(6000);
    const row = browser.rows.get('row-103')!;
    const control = (offset: () => number) => {
      const button = document.createElement('button');
      button.getBoundingClientRect = () => rect(Number.parseFloat(row.outer.style.top) + offset() - browser.root.scrollTop, FOOT_PX);
      row.inner.append(button);
      return button;
    };

    const foot = control(() => browser.heightOf('row-103') - FOOT_PX);
    const footSeen = foot.getBoundingClientRect().top;
    foot.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));
    viewport.window.press(foot);
    browser.resize('row-103', 400);
    expect(row.outer.style.height).toBe('400px');
    await settle();
    expect(Math.abs(foot.getBoundingClientRect().top - footSeen)).toBeLessThan(0.5);

    const head = control(() => 0);
    const headSeen = head.getBoundingClientRect().top;
    viewport.window.press(head);
    browser.resize('row-103', 700);
    await settle();
    expect(Math.abs(head.getBoundingClientRect().top - headSeen)).toBeLessThan(0.5);

    viewport.window.press(head);
    sync(undefined, new Map([['row-103', 1200]]));
    expect(browser.rows.get('row-103')!.outer.style.height).toBe('700px');
    await settle();
    expect(browser.rows.get('row-103')!.outer.style.height).toBe('700px');

    const again = control(() => browser.heightOf('row-103') - FOOT_PX);
    const againSeen = again.getBoundingClientRect().top;
    viewport.window.press(again);
    browser.resizeAll([
      ['row-90', 160],
      ['row-103', 800],
    ]);
    await settle();
    expect(Math.abs(again.getBoundingClientRect().top - againSeen)).toBeLessThan(0.5);
    viewport.dispose();
  });

  test('keeps the row on screen in place when the feed changes width and rows above measured at the old one are out of the window', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    await read(6000);
    browser.resize('row-85', 300);
    await settle();
    await read(9000);
    expect(browser.rows.has('row-85')).toBe(false);
    const anchor = browser.topRow();
    const seen = browser.screenTop(anchor)!;

    browser.widen(600);
    sync(keys());
    await settle();

    expect(Math.abs(browser.screenTop(anchor)! - seen)).toBeLessThan(0.5);
    viewport.dispose();
  });

  test('whose row on screen is withdrawn with everything around it finds the nearest surviving row after it', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    await read(100 * ROW_PX + 20);
    expect(browser.topRow()).toBe('row-100');

    sync(keys().filter((key) => Number(key.slice(4)) < 40 || Number(key.slice(4)) > 160));
    await settle();

    expect(Math.abs(browser.screenTop('row-161')!)).toBeLessThan(0.5);
    viewport.dispose();
  });

  test('a seeded run of growth, pages, arrivals and reading never moves a paused reader and keeps a following one at the tail', async () => {
    let seed = 20261028;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const { browser, viewport, sync, settle, read, keys } = await opened(numbered(1000, 1200));
    let older = 1000;
    let newer = 1200;
    await read(browser.root.scrollTop - 4000);
    for (let step = 0; step < 50; step += 1) {
      const anchor = browser.topRow();
      const seen = browser.screenTop(anchor);
      const following = viewport.following;
      const roll = random();
      let reading = false;
      if (roll < 0.2) {
        reading = true;
        await read(Math.max(3000, browser.root.scrollTop + (random() - 0.6) * 2400));
      } else if (roll < 0.45) {
        const shown = [...browser.rows.keys()];
        const key = shown[Math.floor(random() * shown.length)]!;
        const above = (browser.screenTop(key) ?? 0) + browser.heightOf(key) <= 0;
        browser.resize(key, Math.max(20, browser.heightOf(key) + Math.round((above ? random() - 0.4 : random()) * 300)));
      } else if (roll < 0.65) {
        sync([...keys(), ...numbered(newer, newer + 3)]);
        newer += 3;
      } else if (roll < 0.75) {
        sync([...numbered(older - 40, older), ...keys()]);
        older -= 40;
      } else {
        const last = keys().at(-1)!;
        browser.resize(last, browser.heightOf(last) + Math.round(random() * 200));
      }
      await settle();
      if (reading) continue;
      if (following) expect(browser.atEnd()).toBe(true);
      else if (seen !== undefined && browser.screenTop(anchor) !== undefined)
        expect(Math.abs(browser.screenTop(anchor)! - seen)).toBeLessThan(0.5);
    }
    viewport.dispose();
  });
});

describe('whose hand moved the feed', () => {
  test('a movement no input explains is the tail undone for a feed riding it, and the reader own for a paused one', async () => {
    const { browser, viewport, settle, read } = await opened();
    browser.root.scrollTop = 2000;
    await settle();
    expect(viewport.following).toBe(true);
    expect(browser.atEnd()).toBe(true);

    await read(6000);
    browser.root.scrollTop = 2000;
    await settle();
    expect(browser.root.scrollTop).toBe(2000);
    expect(viewport.following).toBe(false);
    viewport.dispose();
  });

  test('keyboard focus inside the feed holds it while it stays, and the feed returns to the tail when focus leaves', async () => {
    const { browser, viewport, settle } = await opened();
    const top = browser.root.scrollTop;
    const control = document.createElement('button');
    browser.rows.get('row-199')!.inner.append(control);
    control.focus();
    viewport.syncFocus(control);

    browser.resize('row-199', 400);
    await settle();
    expect(browser.root.scrollTop).toBe(top);

    control.blur();
    viewport.syncFocus(null);
    await settle();
    expect(browser.atEnd()).toBe(true);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('wheel steps over the composer add up within a frame and are the reader own movement', async () => {
    const { browser, viewport, settle } = await opened();
    const top = browser.root.scrollTop;

    viewport.scrollBy(-100);
    viewport.scrollBy(-100);
    await settle();

    expect(browser.root.scrollTop).toBe(top - 200);
    expect(viewport.following).toBe(false);
    viewport.dispose();
  });

  test('a wheel down near the bottom of a paused feed rides the tail again', async () => {
    const { browser, viewport, settle, read } = await opened();
    await read(browser.root.scrollTop - 50);
    expect(viewport.following).toBe(false);

    browser.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 10 }));
    await settle();

    expect(viewport.following).toBe(true);
    expect(browser.atEnd()).toBe(true);
    viewport.dispose();
  });
});

describe('older history', () => {
  test('an untouched thread at its tail asks for nothing', async () => {
    const asks: number[] = [];
    const { browser, viewport, settle } = await opened();
    viewport.useHead(() => {
      asks.push(browser.root.scrollTop);
      return Promise.resolve(true);
    });
    browser.resize('row-199', 200);
    await settle();

    expect(asks).toEqual([]);
    viewport.dispose();
  });

  test('a reader within three screens of the head asks for one page, and again only once it landed', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened();
    let pages = 0;
    viewport.useHead(() => {
      pages += 1;
      return Promise.resolve().then(() => {
        sync([...numbered(pages * 100, pages * 100 + 100, 'older'), ...keys()]);
        return true;
      });
    });
    await read(4000);
    expect(pages).toBe(0);

    await read(1500);
    expect(pages).toBe(1);
    expect(browser.root.scrollTop).toBeGreaterThan(1500 + 99 * ROW_PX);

    await read(1000);
    expect(pages).toBe(2);
    viewport.dispose();
  });

  test('a page still loading for the thread left behind never touches the paging of the thread opened next', async () => {
    const { viewport, sync, settle, read, keys } = await opened();
    let finishA: (loaded: boolean) => void = () => undefined;
    let asksB = 0;
    viewport.openThread('a');
    sync(keys());
    await settle();
    viewport.useHead(() => new Promise<boolean>((resolve) => (finishA = resolve)));
    await read(1000);

    viewport.openThread('b');
    sync(keys());
    await settle();
    viewport.useHead(() => {
      asksB += 1;
      return new Promise<boolean>(() => undefined);
    });
    await read(1000);
    expect(asksB).toBe(1);

    finishA(false);
    await settle();
    await read(800);
    expect(asksB).toBe(1);
    viewport.dispose();
  });

  test('a feed too short to scroll is filled once and waits for fresh input to fill again', async () => {
    const { browser, viewport, settle } = await opened(numbered(0, 4));
    let fills = 0;
    viewport.useFill(() => {
      fills += 1;
      return Promise.resolve(true);
    });
    viewport.resized();
    await settle();
    viewport.resized();
    await settle();
    expect(fills).toBe(1);

    browser.root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
    await settle();
    expect(fills).toBe(2);
    viewport.dispose();
  });
});

describe('which message of the operator the feed is on', () => {
  const messages = ['row-10', 'row-120', 'row-190'];

  test('a feed riding its tail is on the latest message from its first frame', () => {
    const viewport = new TranscriptViewport(new FeedMemory());
    viewport.useMessages(() => messages.map((id) => ({ id })));

    expect(viewport.currentMessageId).toBe('row-190');
    viewport.dispose();
  });

  test('the current message is the one whose turn is under the reading line, not the nearest one on screen', async () => {
    const { viewport, read } = await opened(numbered(0, 200), messages);

    await read(117 * ROW_PX);
    expect(viewport.currentMessageId).toBe('row-10');

    await read(125 * ROW_PX);
    expect(viewport.currentMessageId).toBe('row-120');
    viewport.dispose();
  });

  test('the tile changes in the scroll event that carries the line over a message, and a jump to the latest lights it at once', async () => {
    const { browser, viewport, read } = await opened(numbered(0, 200), messages);
    await read(121 * ROW_PX);
    expect(viewport.currentMessageId).toBe('row-120');

    browser.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    browser.root.scrollTop = 118 * ROW_PX;
    browser.root.dispatchEvent(new Event('scroll'));
    expect(viewport.currentMessageId).toBe('row-10');

    viewport.resume();
    expect(viewport.currentMessageId).toBe('row-190');
    viewport.dispose();
  });

  test('a message far above the mounted rows is reached and stays the current one while the tail keeps growing', async () => {
    const { browser, viewport, sync, settle, keys } = await opened(numbered(0, 200), messages);

    viewport.select('row-10', 'auto');
    await settle();
    browser.resize('row-199', 500);
    sync([...keys(), 'row-200']);
    await settle();

    expect(browser.screenTop('row-10')).toBe(12);
    expect(viewport.following).toBe(false);
    expect(viewport.currentMessageId).toBe('row-10');
    viewport.dispose();
  });

  test('a landed select lets the browser move the view: the tile follows the reading line and rows landing above do not pull it back', async () => {
    const { browser, viewport, sync, settle, keys } = await opened(numbered(0, 200), messages);
    viewport.select('row-10', 'auto');
    await settle();
    expect(viewport.currentMessageId).toBe('row-10');

    browser.root.scrollTop = 125 * ROW_PX;
    await settle();
    expect(viewport.currentMessageId).toBe('row-120');
    const anchor = browser.topRow();
    const seen = browser.screenTop(anchor)!;

    sync([...numbered(0, 5, 'older'), ...keys()]);
    await settle();
    expect(Math.abs(browser.screenTop(anchor)! - seen)).toBeLessThan(0.5);
    viewport.dispose();
  });

  test('older rows landing above a message on its way keep the feed going to that message', async () => {
    const { browser, viewport, sync, settle, keys } = await opened(numbered(0, 200), messages);

    viewport.select('row-10', 'smooth');
    sync([...numbered(0, 3, 'older'), ...keys()]);
    await settle();

    expect(browser.screenTop('row-10')).toBe(12);
    expect(viewport.currentMessageId).toBe('row-10');
    viewport.dispose();
  });

  test('a paused reader on the last message stays on it while the tail grows below', async () => {
    const { browser, viewport, sync, settle, read, keys } = await opened(numbered(0, 200), messages);
    await read(11_200);
    expect(viewport.currentMessageId).toBe('row-190');

    sync([...keys(), ...numbered(200, 230)]);
    await settle();

    expect(browser.root.scrollTop).toBe(11_200);
    expect(viewport.currentMessageId).toBe('row-190');
    viewport.dispose();
  });

  test('a message that cannot land at the top stays current while it is in view', async () => {
    const { browser, viewport, settle, read } = await opened(numbered(0, 200), ['row-10', 'row-194', 'row-197']);

    viewport.select('row-194', 'auto');
    await settle();
    expect(viewport.currentMessageId).toBe('row-194');

    await read(browser.root.scrollTop - 20);
    expect(viewport.currentMessageId).toBe('row-194');

    await read(11_000);
    expect(viewport.currentMessageId).toBe('row-10');
    viewport.dispose();
  });
});
