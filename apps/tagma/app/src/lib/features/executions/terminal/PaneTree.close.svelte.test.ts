// @vitest-environment jsdom
import { SvelteMap } from 'svelte/reactivity';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import TerminalPaneTree from './PaneTree.svelte';
import { paneNode, splitPane, removePane } from './paneLayout.js';
import type { TerminalTab } from './Tab.svelte.js';
import type { TerminalKeymap } from './Keymap.js';
import type { TerminalAppearance } from '../appearance/Settings.svelte.js';

class PaneStand {
  constructor(readonly id: string) {}
  label = $state<string | null>(null);
  locating = $state(false);
  searching = $state(false);
  ending = $state<unknown>(null);
  refusal = $state<unknown>(null);
  readonly search = null;
  watchPlace(): () => void {
    return () => undefined;
  }
  attach(): void {}
  detach(): void {}
  focus(): void {}
  pastePaths(): void {}
  noteProblem(): void {}
  dismissRefusal(): void {}
}

class TabStand {
  readonly panes = new SvelteMap<string, PaneStand>();
  layout = $state.raw(paneNode('a'));
  active = $state('a');
  expanded = $state<string | null>(null);
  renaming = $state<string | null>(null);
  dragging = $state<string | null>(null);
  menu = $state<null>(null);
  count = $derived(this.panes.size);
  order = $derived([...this.panes.keys()]);
  readonly style = {
    activePaneOpacity: 1,
    inactivePaneOpacity: 0.7,
    opacityTransitionMs: 0,
    dividerThicknessPx: 4,
    paddingX: 0,
    paddingY: 0,
  };
  constructor() {
    this.panes.set('a', new PaneStand('a'));
    this.panes.set('b', new PaneStand('b'));
    this.layout = splitPane(this.layout, 'a', 'b', 'row');
  }
  mount(): void {}
  unmount(): void {}
  activate(): void {}
  followMouse(): void {}
  openMenu(): boolean {
    return false;
  }
  close(id: string, order: 'map-first' | 'layout-first'): void {
    const remaining = removePane(this.layout, id);
    if (remaining === null) return;
    if (order === 'map-first') this.panes.delete(id);
    this.layout = remaining;
    if (order === 'layout-first') this.panes.delete(id);
  }
}

let apps: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  for (const close of apps.splice(0)) close();
  document.body.replaceChildren();
});

test.each(['map-first', 'layout-first'] as const)(
  'closing one pane of a split (%s) tears its host down and leaves the other standing',
  (order) => {
    const stand = new TabStand();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = mount(TerminalPaneTree, {
      target: host,
      props: {
        tab: stand as unknown as TerminalTab,
        keymap: {} as TerminalKeymap,
        appearance: { dividerColor: '#000', paneBackground: '#000', titleTone: 'dark' } as unknown as TerminalAppearance,
        isMac: true,
      },
    });
    flushSync();
    apps.push(() => {
      unmount(app);
      host.remove();
    });
    expect(host.querySelectorAll('.pane[data-pane-id]').length).toBe(2);

    expect(() => {
      stand.close('a', order);
      flushSync();
    }).not.toThrow();
    expect([...host.querySelectorAll<HTMLElement>('.pane[data-pane-id]')].map((pane) => pane.dataset.paneId)).toEqual(['b']);
  },
);
