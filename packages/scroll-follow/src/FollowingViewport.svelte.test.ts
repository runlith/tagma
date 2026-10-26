// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FollowingViewport } from './FollowingViewport.svelte';

afterEach(() => vi.useRealTimers());

function feed() {
  vi.useFakeTimers();
  const root = document.createElement('div');
  let height = 4000;
  Object.defineProperty(root, 'scrollHeight', { get: () => height });
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  root.scrollTop = 3400;
  const viewport = new FollowingViewport({ autoFollows: () => true });
  viewport.attach(root);
  return {
    root,
    viewport,
    grow: () => {
      height += 400;
    },
  };
}

describe('following request lifecycle', () => {
  test('pausing cancels every pending snap and explicit resume follows later growth', () => {
    const { root, viewport, grow } = feed();
    viewport.scrollToBottom(true);
    viewport.scrollToBottom(false);
    viewport.gesture(-1);
    root.scrollTop -= 1;
    root.dispatchEvent(new Event('scroll'));
    grow();
    vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(3399);
    expect(viewport.following).toBe(false);

    viewport.resume();
    vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(4400);
    expect(viewport.following).toBe(true);
    viewport.dispose();
  });

  test('a press keeps a queued snap off the feed and a drag under it takes the reader off the tail', () => {
    const { root, viewport, grow } = feed();
    viewport.scrollToBottom(true);
    viewport.hold('press');
    grow();
    vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(3400);

    root.scrollTop = 1200;
    root.dispatchEvent(new Event('scroll'));
    viewport.release('press');
    vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(1200);
    expect(viewport.following).toBe(false);
    viewport.dispose();
  });

  test('disposal releases pending scrolling before the detached content changes', () => {
    const { root, viewport, grow } = feed();
    viewport.scrollToBottom(true);
    viewport.dispose();
    grow();
    vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(3400);
  });
});
