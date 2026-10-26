// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';

import Floater from './test-utils/Floater.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('places the layer again on a resize or a scroll, and closes it once the anchor leaves the page', () => {
  let anchorBox = new DOMRect(100, 50, 80, 20);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.matches('[data-anchor]') ? anchorBox : new DOMRect();
  });
  const resized: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(changed: () => void) {
        resized.push(changed);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Floater, { target });
  const anchor = document.querySelector<HTMLElement>('[data-anchor]')!;
  const floating = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-float]');

  anchor.click();
  flushSync();
  expect([floating()!.style.left, floating()!.style.top]).toEqual(['100px', '74px']);

  anchorBox = new DOMRect(100, 300, 80, 20);
  for (const changed of resized) changed();
  flushSync();
  expect(floating()!.style.top).toBe('324px');

  anchorBox = new DOMRect(40, 120, 80, 20);
  document.dispatchEvent(new Event('scroll'));
  flushSync();
  expect([floating()!.style.left, floating()!.style.top]).toEqual(['40px', '144px']);

  anchor.remove();
  document.dispatchEvent(new Event('scroll'));
  flushSync();
  expect(floating()).toBeNull();

  void unmount(app);
});
