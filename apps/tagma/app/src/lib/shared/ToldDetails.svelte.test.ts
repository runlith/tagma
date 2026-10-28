// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import ToldDetails from './ToldDetails.svelte';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('details given a link make every block name in them a link, and nothing else', async () => {
  app = mountShell(Layer.mergeAll());
  const host = app.draw(ToldDetails as never, {
    told: { text: 'Refused', details: ['a1b2c3d4 → e5f6a7b8 (edge relates)'], code: 'stealth-dependency' },
    linked: (name: string) => `/runlith/b/${name}`,
  });
  await flush();

  expect([...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/runlith/b/a1b2c3d4', '/runlith/b/e5f6a7b8']);
  expect(host.querySelector('[data-told-details] p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('a1b2c3d4 → e5f6a7b8 (edge relates)');
});
