// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import TerminalDivider from './Divider.svelte';
import { nodeAt, paneNode, setRatio, splitNode, type SplitPath } from './paneLayout.js';
import type { TerminalTab } from './Tab.svelte.js';

const SPAN_PX = 400;
const LINE_PX = 3;

type Written = { path: SplitPath; ratio: number };

function tabOver(ratio: number): { tab: TerminalTab; written: Written[]; holds: number; releases: number } {
  const state = { holds: 0, releases: 0 };
  const written: Written[] = [];
  const pane = {
    holdResize: () => {
      state.holds += 1;
      return () => {
        state.releases += 1;
      };
    },
  };
  const tab = $state({
    layout: splitNode('row', paneNode('a'), paneNode('b'), ratio),
    panes: new Map([
      ['a', pane],
      ['b', pane],
    ]),
    resize(path: SplitPath, next: number) {
      written.push({ path, ratio: next });
      this.layout = setRatio(this.layout, path, next);
    },
    refit: () => undefined,
  });
  return {
    tab: tab as unknown as TerminalTab,
    written,
    get holds() {
      return state.holds;
    },
    get releases() {
      return state.releases;
    },
  };
}

let apps: (() => void)[] = [];

afterEach(() => {
  for (const close of apps.splice(0)) close();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function draw(tab: TerminalTab): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: SPAN_PX + LINE_PX, configurable: true });
  document.body.appendChild(host);
  const app = mount(TerminalDivider, {
    target: host,
    props: {
      tab,
      path: [],
      get direction() {
        const node = nodeAt(tab.layout, []);
        return node?.kind === 'split' ? node.direction : 'row';
      },
      thickness: LINE_PX,
      hidden: false,
    },
  });
  flushSync();
  apps.push(() => unmount(app));
  const handle = host.querySelector<HTMLElement>('[role="separator"]');
  if (handle === null) throw new Error('No divider drawn.');
  return handle;
}

test('a drag holds both sides’ ptys through every frame it reshapes the split, lands where released and lets them go', () => {
  const frames: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const held = tabOver(0.5);
  const handle = draw(held.tab);

  handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 300, bubbles: true }));
  expect(held.holds).toBe(2);
  for (const x of [280, 260, 250]) {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, bubbles: true }));
    for (const frame of frames.splice(0)) frame();
    flushSync();
    expect(held.releases).toBe(0);
  }
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 250, bubbles: true }));

  expect(held.releases).toBe(2);
  expect(held.written.at(-1)).toEqual({ path: [], ratio: (SPAN_PX / 2 - 50) / SPAN_PX });
});

test('a double-click resets the split to even', () => {
  const { tab, written } = tabOver(0.8);
  const handle = draw(tab);

  handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

  expect(written.at(-1)).toEqual({ path: [], ratio: 0.5 });
});
