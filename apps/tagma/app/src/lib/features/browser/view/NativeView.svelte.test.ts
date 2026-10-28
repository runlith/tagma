// @vitest-environment jsdom

import type { DesktopBrowser, PageRect, PageShown } from '@tagma/desktop/bridge';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import NativeView from './NativeView.svelte';

const FRAME = 'data:image/jpeg;base64,frame';
const SHOWN: PageShown = { page: 'page-1', panel: 'panel-1' };

type Placed = PageShown & { readonly rect: PageRect; readonly frozen: boolean };
type Capture = { readonly page: string; readonly answer: (frame: string | null) => void };

const cleanups: (() => void)[] = [];

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

beforeAll(() => {
  HTMLImageElement.prototype.decode = () => Promise.resolve();
});

afterAll(() => {
  delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  flushSync();
  document.body.replaceChildren();
  await frame();
});

async function settled(): Promise<void> {
  for (let step = 0; step < 4; step += 1) await frame();
  flushSync();
}

function sized<T extends Element>(element: T, rect: DOMRect): T {
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => rect, configurable: true });
  return element;
}

const same = (placed: Placed | null, shown: PageShown): boolean => placed?.page === shown.page && placed.panel === shown.panel;

function shownPage() {
  const host = { placed: null as Placed | null, captures: [] as Capture[] };
  const bridge = {
    show: (shown: PageShown, rect: PageRect) => {
      host.placed = { ...shown, rect, frozen: same(host.placed, shown) && host.placed!.frozen };
    },
    hide: (shown: PageShown) => {
      if (same(host.placed, shown)) host.placed = null;
    },
    freeze: (shown: PageShown, frozen: boolean) => {
      if (same(host.placed, shown)) host.placed = { ...host.placed!, frozen };
    },
    capture: (page: string) => new Promise<string | null>((answer) => host.captures.push({ page, answer })),
    onElsewhere: () => () => undefined,
  };
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(NativeView, {
    target,
    props: { page: SHOWN.page as PageId, panel: SHOWN.panel, bridge: bridge as unknown as DesktopBrowser },
  });
  cleanups.push(() => void unmount(view));
  flushSync();
  sized(document.querySelector('[data-native-page]')!, new DOMRect(0, 0, 800, 600));
  window.dispatchEvent(new Event('resize'));
  flushSync();
  return {
    host,
    image: () => document.querySelector('[data-native-page] img')?.getAttribute('src') ?? null,
    answer: async (shot: string | null) => {
      for (const capture of host.captures.splice(0)) capture.answer(shot);
      await settled();
    },
  };
}

function notice(rect: DOMRect): () => void {
  const element = sized(document.createElement('div'), rect);
  document.body.append(element);
  const detach = overlayLayers.notice(element);
  const close = (): void => {
    if (typeof detach === 'function') detach();
    element.remove();
  };
  cleanups.push(close);
  return close;
}

function pointer(type: string, x: number, buttons: number): void {
  document.body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons, clientX: x, clientY: 10 }));
}

const placedAt = { ...SHOWN, rect: { x: 0, y: 0, width: 800, height: 600 } };

describe('the native page under the layer stack', () => {
  it('stands a frame in for the page while a layer covers it, and returns the page once the layer closes', async () => {
    const page = shownPage();
    expect(page.host.placed).toEqual({ ...placedAt, frozen: false });

    const close = notice(new DOMRect(700, 10, 200, 60));
    await settled();
    expect(page.host.captures.map((capture) => capture.page)).toEqual(['page-1']);
    await page.answer(FRAME);
    expect(page.host.placed).toEqual({ ...placedAt, frozen: true });
    expect(page.image()).toBe(FRAME);

    close();
    await settled();
    expect(page.host.placed).toEqual({ ...placedAt, frozen: false });
  });

  it('leaves the page in place under a layer beside it', async () => {
    const page = shownPage();

    notice(new DOMRect(820, 10, 200, 60));
    await settled();
    expect(page.host.captures).toEqual([]);
    expect(page.host.placed).toEqual({ ...placedAt, frozen: false });
  });

  it('takes the frame on the intent to open, before the layer is drawn, and needs no second one', async () => {
    const page = shownPage();

    overlayLayers.intend();
    expect(page.host.captures.map((capture) => capture.page)).toEqual(['page-1']);
    await page.answer(FRAME);

    notice(new DOMRect(100, 100, 300, 200));
    await settled();
    expect(page.host.captures).toEqual([]);
    expect(page.host.placed).toEqual({ ...placedAt, frozen: true });
    expect(page.image()).toBe(FRAME);
  });

  it('keeps the page in place when the frame answers after the layer has closed', async () => {
    const page = shownPage();

    const close = notice(new DOMRect(100, 100, 300, 200));
    await settled();
    close();
    await settled();
    await page.answer(FRAME);
    expect(page.host.placed).toEqual({ ...placedAt, frozen: false });
  });

  it('stands a frame in for the page while a drag holds the pointer', async () => {
    const page = shownPage();

    pointer('pointerdown', 900, 1);
    pointer('pointermove', 920, 1);
    await settled();
    await page.answer(FRAME);
    expect(page.host.placed).toEqual({ ...placedAt, frozen: true });
    expect(page.image()).toBe(FRAME);

    pointer('pointerup', 920, 0);
    await settled();
    expect(page.host.placed).toEqual({ ...placedAt, frozen: false });
  });
});
