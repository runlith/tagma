// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import Asked from './Asked.fixture.svelte';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

const asked = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-asked][data-state="open"]');

function ask(): void {
  document.querySelector<HTMLElement>('[data-ask]')!.click();
  flushSync();
}

test('a question its owner opens by value opens again after Escape, the close button or the scrim closed it', async () => {
  app = mountShell(Layer.mergeAll());
  app.draw(Asked as never);
  const closers = [
    () =>
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-slot="dialog-close"], button')]
        .find((node) => node.textContent?.trim() === 'Close')!
        .click(),
    () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!.click(),
  ];
  for (const [at, close] of closers.entries()) {
    ask();
    await waitUntil(() => asked() !== null);
    expect(asked(), `opened before closer ${at}`).not.toBeNull();
    close();
    flushSync();
    await waitUntil(() => asked() === null);
    expect(asked(), `closed by closer ${at}`).toBeNull();
  }
  ask();
  await waitUntil(() => asked() !== null);
});
