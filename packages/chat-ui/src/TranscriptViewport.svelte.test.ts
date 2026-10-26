// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FeedMemory } from './FeedMemory';
import { TranscriptViewport } from './TranscriptViewport.svelte';

function container(input: { scrollHeight: number; clientHeight: number; scrollTop?: number }): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollHeight', { value: input.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: input.clientHeight, configurable: true });
  element.scrollTop = input.scrollTop ?? 0;
  document.body.append(element);
  return element;
}

function scroll(element: HTMLElement, top: number): void {
  element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: top - element.scrollTop || -120 }));
  drift(element, top);
}

function drift(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function frames(): Promise<void> {
  vi.advanceTimersToNextFrame();
  vi.advanceTimersToNextFrame();
  await Promise.resolve();
}

function opened(input: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const viewport = new TranscriptViewport(new FeedMemory());
  const root = container(input);
  const asks: number[] = [];
  const fills: number[] = [];
  viewport.attach(root);
  viewport.useHead(() => {
    asks.push(root.scrollTop);
    return true;
  });
  viewport.useFill(() => {
    fills.push(root.scrollTop);
    return true;
  });
  return { asks, fills, root, viewport };
}

describe('what a transcript does when it is opened', () => {
  test('opening a thread lands at the bottom and asks for nothing', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 0 });

    viewport.scrollToBottom(true);
    await frames();
    drift(root, root.scrollTop);
    await frames();
    expect(viewport.following).toBe(true);

    Object.defineProperty(root, 'scrollHeight', { value: 120_000, configurable: true });
    viewport.scrollToBottom(false);
    await frames();
    drift(root, root.scrollTop);
    await frames();

    expect(root.scrollTop).toBe(120_000);
    expect(viewport.following).toBe(true);
    expect(asks).toEqual([]);
  });

  test('an untouched thread never asks for the page above it', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 120_000, clientHeight: 600, scrollTop: 0 });
    viewport.scrollToBottom(true);
    await frames();
    drift(root, root.scrollTop);
    await frames();

    expect(asks).toEqual([]);
    expect(viewport.following).toBe(true);
  });

  test('a reader who left the tail and scrolled to the top asks for the page above', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });

    scroll(root, 1800);
    await frames();
    expect(viewport.following).toBe(false);
    expect(asks).toEqual([]);

    scroll(root, 120);
    await frames();
    expect(asks).toEqual([120]);
  });

  test('one continuous gesture spends one page even when the head stays in view', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1800);
    await frames();
    expect(viewport.following).toBe(false);

    scroll(root, 120);
    await frames();
    scroll(root, 60);
    await frames();

    drift(root, 0);
    viewport.syncAnchor();
    await frames();
    expect(asks).toEqual([120]);

    await vi.advanceTimersByTimeAsync(300);
    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
    await frames();
    expect(asks).toEqual([120, 0]);
  });

  test('a reader who left the tail but is nowhere near the top asks for nothing', async () => {
    const { asks, root } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1800);
    await frames();
    scroll(root, 900);
    await frames();
    expect(asks).toEqual([]);
  });

  test('a feed too short to scroll is filled, not paged', async () => {
    const { asks, fills, root, viewport } = opened({ scrollHeight: 600, clientHeight: 600, scrollTop: 0 });
    expect(viewport.following).toBe(true);

    scroll(root, 0);
    await frames();

    expect(fills).toEqual([0]);
    expect(asks).toEqual([]);
  });

  test('a short feed spends one fill and waits for fresh input to fetch more', async () => {
    const { fills, root, viewport } = opened({ scrollHeight: 600, clientHeight: 600 });
    viewport.syncAnchor();
    await frames();
    viewport.syncAnchor();
    drift(root, 0);
    await frames();
    expect(fills).toEqual([0]);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
    await frames();
    expect(fills).toEqual([0, 0]);
    viewport.dispose();
  });

  test('holding a scroll key spends one page and pressing it again requests the next', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    drift(root, 0);
    await frames();
    await vi.advanceTimersByTimeAsync(300);
    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home', repeat: true }));
    await frames();
    expect(asks).toEqual([0]);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    await frames();
    expect(asks).toEqual([0, 0]);
    viewport.dispose();
  });

  test('downward input near the head preserves the loaded history', async () => {
    const { asks, root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600 });
    viewport.pause();
    scroll(root, 60);
    await frames();
    expect(asks).toEqual([]);
    viewport.dispose();
  });

  test('a reader at the top of a scrollable feed is paged, not filled', async () => {
    const { asks, fills, root } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1800);
    await frames();
    scroll(root, 120);
    await frames();

    expect(asks).toEqual([120]);
    expect(fills).toEqual([]);
  });
});

describe('which thread this owner is looking at', () => {
  test('a thread opened after the reader left the tail of another one rides its tail again', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1200);
    await frames();
    expect(viewport.following).toBe(false);

    viewport.openThread('thread-b');

    expect(viewport.following).toBe(true);
  });

  test('restating the thread already open changes nothing', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    viewport.openThread('thread-a');
    scroll(root, 1200);
    await frames();
    expect(viewport.following).toBe(false);

    viewport.openThread('thread-a');

    expect(viewport.following).toBe(false);
  });
});

describe('whose hand moved the feed', () => {
  test('a scroll nobody made does not take the reader off the tail', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    expect(viewport.following).toBe(true);

    drift(root, 1200);
    await frames();

    expect(viewport.following).toBe(true);
  });

  test('the same movement under the reader hand takes them off the tail', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });

    scroll(root, 1200);
    await frames();

    expect(viewport.following).toBe(false);
  });

  test('momentum after the hand lifts is still the reader travelling', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 2000);
    await frames();

    drift(root, 1500);
    await frames();
    drift(root, 1000);
    await frames();

    expect(viewport.following).toBe(false);
  });

  test('a wheel over the feed is the reader own hand', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600 });
    expect(viewport.gesturing).toBe(false);

    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    expect(viewport.gesturing).toBe(true);
  });

  test('a wheel a nested scrollable can still take is not the feed gesture', () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600 });
    const nested = document.createElement('div');
    nested.dataset.scrollable = '';
    Object.defineProperty(nested, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(nested, 'clientHeight', { value: 300, configurable: true });
    nested.scrollTop = 400;
    root.append(nested);

    nested.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    expect(viewport.gesturing).toBe(false);

    nested.scrollTop = 0;
    nested.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    expect(viewport.gesturing).toBe(true);
  });

  test('the feed never hands anchoring to the browser', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    viewport.syncAnchor();
    expect(root.style.overflowAnchor).toBe('none');

    scroll(root, 1200);
    await frames();
    viewport.syncAnchor();
    expect(viewport.following).toBe(false);
    expect(root.style.overflowAnchor).toBe('none');
  });
});

describe('where a transcript rests while its rows are measured', () => {
  test('scrolling through an overlay yields to the reader before the position moves', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    viewport.scrollToBottom(true);
    viewport.scrollBy(-1);
    root.dispatchEvent(new Event('scroll'));
    await frames();
    expect(root.scrollTop).toBe(3399);
    expect(viewport.following).toBe(false);

    viewport.scrollBy(1);
    root.dispatchEvent(new Event('scroll'));
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('a one-pixel upward gesture cancels a queued forced follow before the frame runs', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    viewport.scrollToBottom(true);
    scroll(root, 3399);
    expect(viewport.following).toBe(false);
    await frames();

    Object.defineProperty(root, 'scrollHeight', { value: 4400, configurable: true });
    viewport.scrollToBottom(false);
    await frames();
    expect(root.scrollTop).toBe(3399);
    expect(viewport.following).toBe(false);

    scroll(root, 3800);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('a new active run preserves a paused reading position', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1200);
    const changed = viewport.contentChanged(20, 'run-next');
    await vi.advanceTimersByTimeAsync(0);
    await changed;
    await frames();

    expect(root.scrollTop).toBe(1200);
    expect(viewport.following).toBe(false);
    viewport.dispose();
  });

  test('an idle thread is still pinned to its bottom when the content grows', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 0 });
    viewport.syncWorking(false);

    viewport.scrollToBottom(false);
    await frames();

    expect(root.scrollTop).toBe(4000);
    expect(viewport.following).toBe(true);
  });

  test('a reader who scrolled away is never pulled back to the bottom', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1200);
    await frames();
    expect(viewport.following).toBe(false);

    viewport.scrollToBottom(false);
    await frames();

    expect(root.scrollTop).toBe(1200);
    expect(viewport.following).toBe(false);
  });

  test('scrolling back to the bottom resumes the ride', async () => {
    const { root, viewport } = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    scroll(root, 1200);
    await frames();
    expect(viewport.following).toBe(false);

    scroll(root, 3400);
    await frames();
    expect(viewport.following).toBe(true);

    viewport.scrollToBottom(false);
    await frames();
    expect(root.scrollTop).toBe(3400);
  });
});

describe('a reader who sees the bottom rides the tail', () => {
  function feed(scrollTop: number) {
    const opening = opened({ scrollHeight: 4000, clientHeight: 600, scrollTop });
    const { root } = opening;
    let top = scrollTop;
    Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, root.scrollHeight - root.clientHeight));
      },
    });
    return opening;
  }

  function grow(root: HTMLElement, height: number): void {
    Object.defineProperty(root, 'scrollHeight', { value: height, configurable: true });
  }

  async function rides(root: HTMLElement, viewport: TranscriptViewport): Promise<void> {
    grow(root, root.scrollHeight + 400);
    viewport.scrollToBottom(false);
    await frames();
    expect(root.scrollTop).toBe(root.scrollHeight - root.clientHeight);
    expect(viewport.following).toBe(true);
  }

  test('a click on the feed beside its column', async () => {
    const { root, viewport } = feed(3400);
    root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    await rides(root, viewport);
    viewport.dispose();
  });

  test('a selection cleared at the bottom', async () => {
    const { root, viewport } = feed(3400);
    const content = document.createElement('p');
    content.textContent = 'an answer worth copying';
    root.append(content);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(content);
    selection.addRange(range);
    viewport.syncSelection(selection, content);
    selection.removeAllRanges();
    viewport.syncSelection(selection, content);
    await rides(root, viewport);
    viewport.dispose();
  });

  test('a wheel down at the bottom of a paused feed', async () => {
    const { root, viewport } = feed(3400);
    viewport.pause();
    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    await rides(root, viewport);
  });

  test('content shrinking under the reader hand clamps onto the bottom', async () => {
    const { root, viewport } = feed(3400);
    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    grow(root, 3800);
    drift(root, 3200);
    await rides(root, viewport);
  });

  test('a scroll that lands on the very bottom, whoever made it', async () => {
    const { root, viewport } = feed(1200);
    viewport.pause();
    drift(root, 3400);
    await rides(root, viewport);
  });

  test('content that shrinks onto the reader position without a scroll', async () => {
    const { root, viewport } = feed(1200);
    viewport.pause();
    grow(root, 1800);
    viewport.resized();
    await rides(root, viewport);
  });

  test('scrolls that land on the tail do not keep the reader hand on it', async () => {
    const { root, viewport } = feed(3400);
    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    for (let snap = 0; snap < 8; snap += 1) {
      grow(root, root.scrollHeight + 100);
      if (snap % 2 === 0) viewport.scrollToBottom(false);
      else drift(root, root.scrollHeight - root.clientHeight);
      await frames();
      root.dispatchEvent(new Event('scroll'));
    }
    expect(viewport.gesturing).toBe(false);
  });
});

describe('where a message is looked for', () => {
  if (typeof CSS === 'undefined') Object.assign(globalThis, { CSS: { escape: (value: string) => value.replace(/["\\]/g, '\\$&') } });

  test('selecting a message scrolls the feed that holds it, not another feed showing the same thread', async () => {
    const other = container({ scrollHeight: 4000, clientHeight: 600 });
    const holding = opened({ scrollHeight: 4000, clientHeight: 600 });
    const targetAt = (root: HTMLElement) => {
      const node = document.createElement('article');
      node.dataset.messageId = 'm1';
      node.getBoundingClientRect = () => ({
        top: 1500,
        bottom: 1560,
        left: 0,
        right: 0,
        width: 0,
        height: 60,
        x: 0,
        y: 1500,
        toJSON: () => ({}),
      });
      root.append(node);
    };
    targetAt(other);
    targetAt(holding.root);
    other.scrollTo = (() => {
      throw new Error('scrolled the wrong feed');
    }) as HTMLElement['scrollTo'];
    const scrolled: number[] = [];
    holding.root.scrollTo = ((options: ScrollToOptions) => {
      scrolled.push(options.top ?? -1);
    }) as HTMLElement['scrollTo'];

    const selected = holding.viewport.select('m1', 'auto');
    await vi.advanceTimersByTimeAsync(0);
    await selected;

    expect(scrolled).toHaveLength(1);
  });
});
