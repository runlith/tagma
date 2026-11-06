// @vitest-environment jsdom
import type { OfferedTheme } from '@tagma/server/appearance/contract/wire/feeds';
import { Layer } from '@runlith/layer/Layer';
import { makeStorage } from '@runlith/layer/testing';
import { flush } from '@runlith/testing/flush';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Appearance, type BootPaint, PAINT_KEY } from './Appearance.svelte.js';

const PROJECT = { id: 1, name: 'one', kind: 'folder' };

const NORD: OfferedTheme = {
  id: 'nord.nord',
  plugin: 'nord',
  pluginTitle: 'Nord',
  theme: { title: 'Nord', dark: { surfaces: { background: '#2e3440' } } },
};

class Sheet {
  text = '';
  replaceSync(text: string): void {
    this.text = text;
  }
}

beforeAll(() => {
  Object.assign(globalThis, { CSSStyleSheet: Sheet });
  Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true });
});

type Frame = (event: never) => void;

function server() {
  const settings: Frame[] = [];
  const catalogs: Frame[] = [];
  let values: Record<string, unknown> = { 'appearance.theme': 'tagma', 'appearance.mode': 'light' };
  let themes: readonly OfferedTheme[] = [NORD];
  const live = {
    hold: (open: (client: unknown) => unknown, frame: Frame) => {
      let feed = '';
      open(new Proxy({}, { get: (_target, name) => () => void (feed = String(name)) }));
      const frames = feed === 'settings.watch' ? settings : catalogs;
      frames.push(frame);
      queueMicrotask(() => frame((feed === 'settings.watch' ? { values } : { themes }) as never));
      return { unsubscribe: () => void frames.splice(frames.indexOf(frame), 1) };
    },
  };
  const door = {
    perform: async (_operation: string, input: { readonly key: string; readonly value: unknown }) => {
      values = { ...values, [input.key]: input.value };
      for (const frame of settings) frame({ values: { [input.key]: input.value } } as never);
      return {};
    },
  };
  const offer = (offered: readonly OfferedTheme[]): void => {
    themes = offered;
    for (const frame of catalogs) frame({ themes } as never);
  };
  return { live, door, offer };
}

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.unmount();
});

function openWindow(world: ReturnType<typeof server>, storage = makeStorage()) {
  const shell = mountShell(
    Layer.mergeAll(Appearance, Notices),
    Layer.mergeAll(
      Layer.of(Live, world.live as never),
      Layer.of(Door, world.door as never),
      Layer.of(Workspace, { contextProject: PROJECT, projects: [PROJECT] } as never),
    ),
    { storage },
  );
  apps.push(shell);
  return { appearance: shell.get(Appearance), storage };
}

test('a theme chosen in one window paints it in every window, and the first frame of the next start reads it', async () => {
  const world = server();
  const first = openWindow(world);
  const second = openWindow(world);
  await flush();
  expect(first.appearance.look.id).toBe('tagma');

  first.appearance.chooseTheme('nord.nord');
  await flush();

  for (const window of [first, second]) {
    expect(window.appearance.look).toMatchObject({ id: 'nord.nord', mode: 'dark', terminal: { background: '#2e3440' } });
    const boot = JSON.parse(window.storage.getItem(PAINT_KEY) ?? 'null') as BootPaint;
    expect(Object.keys(boot.variants)).toEqual(['dark']);
    expect(boot.variants.dark?.declarations).toContain('--background:#2e3440;');
  }
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(first.appearance.onlyLook).toBe('dark');
});

test('a theme whose plugin leaves paints Tagma while the choice stands, and paints again when it returns', async () => {
  const world = server();
  const { appearance } = openWindow(world);
  await flush();
  appearance.chooseTheme('nord.nord');
  await flush();

  world.offer([]);
  await flush();
  expect(appearance.look.id).toBe('tagma');
  expect(appearance.missing).toBe(true);
  expect(appearance.chosen).toBe('nord.nord');

  world.offer([NORD]);
  await flush();
  expect(appearance.look.id).toBe('nord.nord');
  expect(appearance.missing).toBe(false);
});
