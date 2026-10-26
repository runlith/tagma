// @vitest-environment jsdom

import { Layer } from '@runlith/layer/Layer';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { afterEach, expect, it } from 'vitest';

import { Dialogs } from '../DialogRegistry.svelte.js';
import { layers } from '../layers.js';
import DialogStack from '../test-utils/DialogStack.svelte';
import Probe from '../test-utils/Probe.svelte';

const teardowns: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const teardown of teardowns.splice(0)) await teardown();
  document.body.replaceChildren();
});

async function menuInDialog(): Promise<{ dialog: HTMLElement; menu: () => HTMLElement | null; trigger: HTMLElement }> {
  const app = mountApp(Layer.mergeAll(Dialogs), Layer.mergeAll());
  const target = document.createElement('div');
  document.body.append(target);
  const host = mount(DialogStack, { target, props: { app: app.app } });
  teardowns.push(async () => {
    await unmount(host);
    await app.unmount();
  });
  app.get(Dialogs).open(Probe, { name: 'menu', open: true });
  await flush();

  return {
    dialog: document.querySelector<HTMLElement>('[data-runlith-dialog-content]')!,
    menu: () => document.querySelector<HTMLElement>('[data-layer="menu"]'),
    trigger: document.querySelector<HTMLElement>('[data-trigger="menu"]')!,
  };
}

it('closes a menu inside a dialog on a press beside it, and leaves the dialog open', async () => {
  const { dialog, menu } = await menuInDialog();
  expect(menu()).not.toBeNull();

  dialog.firstElementChild!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  await flush();

  expect(menu()).toBeNull();
  expect(dialog.isConnected).toBe(true);
  expect(dialog.dataset.state).toBe('open');
});

it('seats a layer opened from a dialog above it, and the notice step above both', async () => {
  const { dialog, menu } = await menuInDialog();
  const dialogZ = Number(dialog.style.zIndex);
  const menuZ = Number(menu()!.style.zIndex);

  expect(menuZ).toBeGreaterThan(dialogZ);
  expect(layers.notice).toBeGreaterThan(menuZ);
});

it('keeps Tab in one circle through the dialog and a layer opened from it, though that layer stands outside its DOM', async () => {
  const { dialog, menu, trigger } = await menuInDialog();
  const field = document.querySelector<HTMLElement>('[data-field="menu"]')!;
  const tab = (from: HTMLElement, shiftKey = false): void => {
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
  };
  expect(dialog.contains(menu())).toBe(false);
  trigger.focus();

  tab(trigger);
  expect(document.activeElement).toBe(field);
  tab(field);
  expect(document.activeElement).toBe(trigger);
  tab(trigger, true);
  expect(document.activeElement).toBe(field);
});
