// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
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
  await waitUntil(() => dialog() !== null);

  document.querySelector<HTMLElement>('[data-menu-trigger]')!.click();
  flushSync();
  await waitUntil(() => menu() !== null);
  expect(Number(menu()!.style.zIndex)).toBeGreaterThan(Number(dialog()!.style.zIndex));

  escape();
  await waitUntil(() => menu() === null);
  expect(dialog()).not.toBeNull();

  escape();
  await waitUntil(() => dialog() === null);
});
