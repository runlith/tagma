// @vitest-environment jsdom

import { Layer } from '@runlith/layer/Layer';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Dialogs } from '../DialogRegistry.svelte.js';
import DialogStack from '../test-utils/DialogStack.svelte';
import DialogClose from './close.svelte';

async function openStack() {
  const app = mountApp(Layer.mergeAll(Dialogs), Layer.mergeAll());
  const target = document.createElement('div');
  document.body.append(target);
  const host = mount(DialogStack, { target, props: { app: app.app } });
  const dialogs = app.get(Dialogs);
  const lower = dialogs.open(DialogClose, {});
  const upper = dialogs.open(DialogClose, {});
  await flush();
  const [lowerEntry, upperEntry] = dialogs.stack;
  expect(lowerEntry?.open).toBe(true);
  expect(upperEntry?.open).toBe(true);
  const contents = document.querySelectorAll<HTMLElement>('[data-runlith-dialog-content][data-state="open"]');
  expect(contents).toHaveLength(2);

  return {
    lower,
    upper,
    lowerEntry: lowerEntry!,
    upperEntry: upperEntry!,
    top: contents[1]!,
    async destroy() {
      await unmount(host);
      await app.unmount();
      target.remove();
    },
  };
}

async function escape(target: EventTarget) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flush();
}

describe('Escape belongs to one showing in the dialog stack', () => {
  it.each(['content', 'document'] as const)('closes only the top showing from %s', async (origin) => {
    const stack = await openStack();
    try {
      await escape(origin === 'content' ? stack.top : document);
      expect(stack.upperEntry.open).toBe(false);
      expect(stack.lowerEntry.open).toBe(true);

      await escape(document);
      expect(stack.lowerEntry.open).toBe(false);
    } finally {
      await stack.destroy();
    }
  });

  it('leaves the lower showing open when an externally focused control already dismissed the top one', async () => {
    const stack = await openStack();
    const control = document.createElement('button');
    document.body.append(control);
    control.focus();
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stack.upper.close();
    });
    try {
      await escape(control);
      expect(stack.upperEntry.open).toBe(false);
      expect(stack.lowerEntry.open).toBe(true);
    } finally {
      control.remove();
      await stack.destroy();
    }
  });
});
