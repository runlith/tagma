// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import TerminalPaneTitle, { confirmsComposition } from './PaneTitle.svelte';
import type { TerminalPane } from './Pane.svelte.js';
import type { TerminalTab } from './Tab.svelte.js';

class PaneStand {
  label = $state<string | null>(null);
  holder = $state<string | null>(null);
  readonly id = 'p1';
  focus(): void {}
}

class Stand {
  renaming = $state<string | null>(null);
  active = $state('p1');
  expanded = $state<string | null>(null);
  menu = $state<{ pane: string; x: number; y: number; at: number } | null>(null);
  count = $state(2);
  readonly splits: string[] = [];
  readonly closed: string[] = [];
  readonly retitles: { readonly id: string; readonly label: string | null }[] = [];
  equalised = 0;

  readonly standing = new PaneStand();
  readonly pane = this.standing as unknown as TerminalPane;
  readonly panes = new Map([['p1', this.pane]]);

  activate(): void {}
  retitle(id: string, label: string | null): void {
    this.retitles.push({ id, label });
  }
  openMenu(pane: string, x: number, y: number): boolean {
    this.menu = { pane, x, y, at: Date.now() };
    return true;
  }
  closeMenu(): void {
    this.menu = null;
  }
  split(pane: TerminalPane, direction: string): Promise<void> {
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
}

let apps: (() => void)[] = [];

afterEach(() => {
  for (const close of apps.splice(0)) close();
  document.body.replaceChildren();
});

function drawBar(stand: Stand): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalPaneTitle, {
    target: host,
    props: {
      tab: stand as unknown as TerminalTab,
      pane: stand.pane,
      rect: { left: 0, top: 0, width: 400 },
      onDragStart: () => undefined,
    },
  });
  flushSync();
  apps.push(() => {
    unmount(app);
    host.remove();
  });
  return host;
}

test('an untitled pane carries the two controls and no title, and split right splits right', () => {
  const stand = new Stand();
  const host = drawBar(stand);

  expect(host.querySelector('[data-pane-title-text]')).toBeNull();
  expect(host.querySelector('[data-pane-title-bar]')?.hasAttribute('data-chromeless')).not.toBe(false);
  host.querySelector<HTMLElement>('[data-pane-title-split]')?.click();
  flushSync();

  expect(stand.splits).toEqual(['row']);
  host.querySelector<HTMLElement>('[data-pane-title-close]')?.click();
  expect(stand.closed).toEqual(['p1']);
});

test('a set title stands on the bar, and the × takes it off rather than closing the pane', () => {
  const stand = new Stand();
  stand.standing.label = 'build';
  const host = drawBar(stand);

  expect(host.querySelector('[data-pane-title-text]')?.textContent?.trim()).toBe('build');
  host.querySelector<HTMLElement>('[data-pane-title-remove]')?.click();
  flushSync();

  expect(stand.retitles).toEqual([{ id: 'p1', label: null }]);
  expect(stand.closed).toEqual([]);
});

test('renaming commits on Enter, cancels on Escape, and ignores an Enter that only confirms an IME candidate', () => {
  const stand = new Stand();
  stand.renaming = 'p1';
  const host = drawBar(stand);
  const input = host.querySelector<HTMLInputElement>('[data-pane-title-input]');
  if (input === null) throw new Error('renaming drew no input');

  input.value = 'deploy';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
  flushSync();
  expect(stand.renaming).toBe('p1');
  expect(stand.retitles).toEqual([]);

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  flushSync();
  expect(stand.retitles).toEqual([{ id: 'p1', label: 'deploy' }]);
  expect(stand.renaming).toBeNull();
});

test('Escape leaves the title exactly as it stood, writing nothing', () => {
  const stand = new Stand();
  stand.standing.label = 'build';
  stand.renaming = 'p1';
  const host = drawBar(stand);
  const input = host.querySelector<HTMLInputElement>('[data-pane-title-input]');

  if (input !== null) {
    input.value = 'nonsense';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
  flushSync();

  expect(stand.retitles).toEqual([]);
  expect(stand.standing.label).toBe('build');
  expect(stand.renaming).toBeNull();
});

test('an Enter inside a composition is not a commit', () => {
  expect(confirmsComposition(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true);
  expect(confirmsComposition(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }))).toBe(true);
  expect(confirmsComposition(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
});
