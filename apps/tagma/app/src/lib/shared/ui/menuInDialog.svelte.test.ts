// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import MenuInDialog from './MenuInDialog.fixture.svelte';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-runlith-dialog-content][data-state="open"]');
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
}

test('a menu opened in a dialog stands above it, and Escape closes the menu first and the dialog next', async () => {
  app = mountShell(Layer.mergeAll());
  app.draw(MenuInDialog as never);
  await vi.waitFor(() => expect(dialog()).not.toBeNull());

  document.querySelector<HTMLElement>('[data-menu-trigger]')!.click();
  flushSync();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
  expect(Number(menu()!.style.zIndex)).toBeGreaterThan(Number(dialog()!.style.zIndex));

  escape();
  await vi.waitFor(() => expect(menu()).toBeNull());
  expect(dialog()).not.toBeNull();

  escape();
  await vi.waitFor(() => expect(dialog()).toBeNull());
});
