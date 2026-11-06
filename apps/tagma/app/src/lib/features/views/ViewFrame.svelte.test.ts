// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { type Look, Theme, type ThemePort } from '$lib/shared/Theme.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import ViewFrame from './ViewFrame.svelte';

const SANDBOX = 'http://127.0.0.1:5636';

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.unmount();
  document.documentElement.style.removeProperty('--background');
});

test('a framed view hears the new theme colours when the theme changes in the same mode', async () => {
  const theme = $state<{ mode: ThemePort['mode']; look: Look }>({ mode: 'dark', look: { id: 'tagma', mode: 'dark', terminal: {} } });
  const shell = mountShell(Layer.mergeAll(), Layer.of(Theme, theme));
  apps.push(shell);
  shell.get(ServerOrigin).sandbox = SANDBOX;
  const drawn = shell.draw(ViewFrame as never, {
    view: { csp: {}, permissions: {}, html: '<p>view</p>' },
    host: { methods: {}, context: () => ({}) },
    title: 'view',
    identity: { _tag: 'McpView', server: 'board' },
    bordered: false,
  });
  flushSync();
  const target = drawn.querySelector('iframe')!.contentWindow!;
  const told: {
    readonly method?: string;
    readonly params?: { readonly theme?: string; readonly styles?: { readonly variables: Record<string, string> } };
  }[] = [];
  Object.defineProperty(target, 'postMessage', { value: (message: (typeof told)[number]) => void told.push(message) });
  window.dispatchEvent(
    new MessageEvent('message', { data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' }, origin: SANDBOX, source: target }),
  );
  flushSync();
  await frame();
  const changes = () => told.filter((message) => message.method === 'ui/notifications/host-context-changed');
  expect(changes()).toHaveLength(1);

  document.documentElement.style.setProperty('--background', '#15171c');
  theme.look = { id: 'nord.nord', mode: 'dark', terminal: {} };
  flushSync();
  await frame();

  expect(changes()).toHaveLength(2);
  expect(changes()[1]!.params).toMatchObject({ theme: 'dark', styles: { variables: { '--color-background-primary': '#15171c' } } });
});
