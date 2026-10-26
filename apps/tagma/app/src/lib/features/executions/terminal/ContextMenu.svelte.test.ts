// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import TerminalContextMenu from './ContextMenu.svelte';
import { TerminalKeymap } from './Keymap.js';
import type { TerminalPane } from './Pane.svelte.js';
import type { TerminalTab } from './Tab.svelte.js';

class PaneStand {
  readonly id = 'p1';
  label = $state<string | null>(null);
  holder = $state<string | null>(null);
  takingOver = $state(false);
  focused = 0;

  focus(): void {
    this.focused += 1;
  }
  copy(): Promise<boolean> {
    return Promise.resolve(true);
  }
  paste(): Promise<boolean> {
    return Promise.resolve(true);
  }
  selectAll(): void {}
  clear(): void {}
}

class TabStand {
  active = $state('p1');
  renaming = $state<string | null>(null);
  expanded = $state<string | null>(null);
  count = $state(2);
  menu = $state<{ pane: string; x: number; y: number; at: number } | null>({
    pane: 'p1',
    x: 120,
    y: 80,
    at: Date.now() - 1_000,
  });
  readonly splits: string[] = [];
  readonly closed: string[] = [];
  equalised = 0;

  readonly standing = new PaneStand();
  readonly pane = this.standing as unknown as TerminalPane;
  readonly panes = new Map([['p1', this.pane]]);

  closeMenu(): void {
    this.menu = null;
  }
  split(_pane: TerminalPane, direction: string): Promise<void> {
    this.splits.push(direction);
    return Promise.resolve();
  }
  close(id: string): void {
    this.closed.push(id);
  }
  equalise(): void {
    this.equalised += 1;
  }
  expand(): void {}
  retitle(): void {}
}

let apps: (() => void)[] = [];

afterEach(() => {
  for (const close of apps.splice(0)) close();
  document.body.replaceChildren();
});

async function drawMenu(stand: TabStand): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalContextMenu, {
    target: host,
    props: { tab: stand as unknown as TerminalTab, keymap: new TerminalKeymap(new Host('tab', 'macos')) },
  });
  apps.push(() => {
    unmount(app);
    host.remove();
  });
  await settle();
}

async function settle(): Promise<void> {
  flushSync();
  await new Promise((done) => setTimeout(done, 20));
  flushSync();
}

const item = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-menu-${name}]`);

test('the menu offers the pane acts with their chords, and refuses what one pane cannot do but still stops it', async () => {
  const stand = new TabStand();
  stand.count = 1;
  await drawMenu(stand);

  expect(item('equalise')?.getAttribute('data-disabled')).not.toBe(null);
  expect(item('close')).not.toBeNull();
  expect(item('split-right')?.querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent).toBe('⌘D');
  expect(item('clear')?.querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent).toBe('⌘K');
});

test('an item performs its act, closes the menu and puts the keyboard back in the engine', async () => {
  const stand = new TabStand();
  await drawMenu(stand);

  expect(item('equalise')?.getAttribute('data-disabled')).toBe(null);
  item('close')?.click();
  await settle();

  expect(stand.closed).toEqual(['p1']);
  expect(stand.menu).toBeNull();
  expect(stand.standing.focused).toBe(1);
});

test('Escape closes the menu and puts the keyboard back in the engine', async () => {
  const stand = new TabStand();
  await drawMenu(stand);
  expect(item('copy')).not.toBeNull();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();

  expect(stand.menu).toBeNull();
  expect(stand.standing.focused).toBe(1);
  expect(item('copy')).toBeNull();
});
