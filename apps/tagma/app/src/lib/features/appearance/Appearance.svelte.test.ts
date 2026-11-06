// @vitest-environment jsdom
import type { OfferedTheme } from '@tagma/server/appearance/contract/wire/feeds';
import { Layer } from '@runlith/layer/Layer';
import { makeStorage } from '@runlith/layer/testing';
import { flush } from '@runlith/testing/flush';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { UserSettings } from '$lib/features/settings/UserSettings.svelte.js';
import { Actions } from '$lib/features/workspace/action.js';
import { DesktopAppearance } from '$lib/shared/desktop/DesktopAppearance.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Appearance } from './Appearance.svelte.js';
import PluginThemes from './PluginThemes.svelte';

const NORD: OfferedTheme = {
  id: 'nord.nord',
  plugin: 'nord',
  pluginTitle: 'Nord',
  theme: { title: 'Nord', dark: { surfaces: { background: '#15171c' } } },
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
      let asked: readonly string[] = [];
      open(
        new Proxy(
          {},
          {
            get: (_target, name) => (input: { readonly keys?: readonly string[] }) =>
              void ((feed = String(name)), (asked = input.keys ?? [])),
          },
        ),
      );
      const frames = feed === 'settings.watch' ? settings : catalogs;
      frames.push(frame);
      const opening = () => Object.fromEntries(asked.map((key) => [key, values[key]]));
      queueMicrotask(() => frame((feed === 'settings.watch' ? { values: opening() } : { themes }) as never));
      return { unsubscribe: () => void frames.splice(frames.indexOf(frame), 1) };
    },
  };
  const door = {
    perform: async (_operation: string, input: { readonly key: string; readonly value: unknown }) => {
      values = { ...values, [input.key]: input.value };
      for (const frame of settings) frame({ values: { [input.key]: input.value } } as never);
      return { status: 'written' };
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
  const looks: string[] = [];
  const shell = mountShell(
    Layer.mergeAll(Appearance, UserSettings, Notices, Actions),
    Layer.mergeAll(
      Layer.of(Live, world.live as never),
      Layer.of(Door, world.door as never),
      Layer.of(DesktopAppearance, { follow: (look) => void looks.push(look) }),
    ),
    { storage },
  );
  apps.push(shell);
  return { appearance: () => shell.get(Appearance), storage, looks, shell };
}

test('a window paints the person’s theme with no part of it asking for the appearance', async () => {
  const window = openWindow(server());
  await flush();

  expect(window.storage.getItem('appearance.paint')).not.toBeNull();
  expect(window.looks).toEqual(['light']);
});

test('a theme chosen in one window paints it in every window, and the first frame of the next start reads it', async () => {
  const world = server();
  const first = openWindow(world);
  const second = openWindow(world);
  await flush();
  expect(first.appearance().look.id).toBe('tagma');

  first.appearance().chooseTheme('nord.nord');
  await flush();

  for (const window of [first, second]) {
    expect(window.appearance().look).toMatchObject({ id: 'nord.nord', mode: 'dark', terminal: { background: '#15171c' } });
    const boot = JSON.parse(window.storage.getItem('appearance.paint') ?? 'null') as { variants: Record<string, { declarations: string }> };
    expect(Object.keys(boot.variants)).toEqual(['dark']);
    expect(boot.variants.dark?.declarations).toContain('--background:#15171c;');
  }
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(first.appearance().onlyLook).toBe('dark');
  expect(first.looks).toEqual(['light', 'dark']);
});

test('Use on the theme of a plugin that runs nowhere runs the plugin everywhere, then paints the theme', async () => {
  const world = server();
  world.offer([]);
  const { appearance, shell } = openWindow(world);
  await flush();
  let runs = 0;
  const drawn = shell.draw(PluginThemes as never, {
    plugin: 'nord',
    components: [{ kind: 'contribution', name: 'themes', entries: [{ name: 'nord', title: 'Nord' }] }],
    runEverywhere: async () => {
      runs += 1;
      world.offer([NORD]);
      return true;
    },
  });
  await flush();
  drawn.querySelector<HTMLButtonElement>('[data-theme="nord.nord"] button')!.click();
  await flush();

  expect(runs).toBe(1);
  expect(appearance().chosen).toBe('nord.nord');
  expect(appearance().look.id).toBe('nord.nord');
  expect(drawn.querySelector('[data-theme="nord.nord"] button')).toBeNull();
});

test('a theme whose plugin leaves paints Tagma while the choice stands, and paints again when it returns', async () => {
  const world = server();
  const { appearance } = openWindow(world);
  await flush();
  appearance().chooseTheme('nord.nord');
  await flush();

  world.offer([]);
  await flush();
  expect(appearance().look.id).toBe('tagma');
  expect(appearance().missing).toBe(true);
  expect(appearance().chosen).toBe('nord.nord');

  world.offer([NORD]);
  await flush();
  expect(appearance().look.id).toBe('nord.nord');
  expect(appearance().missing).toBe(false);
});
