// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import PinnedRegion from './PinnedRegion.svelte';
import type { ChatEntryContext } from './renderers';
import type { ChatPinBounds } from './surface';

const observed: (() => void)[] = [];
let parentPx = 900;

afterEach(() => {
  observed.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('a pin is handed the limit the region itself holds, and a new one when the surface resizes', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly react: () => void) {}
      observe() {
        observed.push(this.react);
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-surface') ? parentPx : 0;
  });
  const seen: (number | null)[] = [];
  const body = createRawSnippet((_context: () => ChatEntryContext, bounds: () => ChatPinBounds) => ({
    render: () => '<div data-pin=""></div>',
    setup: () => {
      $effect(() => {
        seen.push(bounds().maxHeight);
      });
    },
  }));
  const surface = document.createElement('div');
  surface.setAttribute('data-surface', '');
  document.body.append(surface);
  const app = mount(PinnedRegion, {
    target: surface,
    props: { pins: [{ id: 'pin', body }], context: {} as ChatEntryContext, onHeight: () => undefined },
  });
  flushSync();
  const region = surface.querySelector<HTMLElement>('[data-pinned-region]');
  expect(seen.at(-1)).toBe(300);
  expect(region?.style.maxHeight).toBe('300px');

  parentPx = 600;
  for (const react of observed) react();
  flushSync();
  expect(seen.at(-1)).toBe(200);
  expect(region?.style.maxHeight).toBe('200px');

  void unmount(app);
  surface.remove();
});
