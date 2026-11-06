// @vitest-environment jsdom
import type { WatchedSettings } from '@tagma/server/settings/contract/wire/feeds';
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, soloWorkspace, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { ActionRunner, ShellKeys } from '$lib/app/keys/ports.js';
import { ActionRegistry } from '$lib/app/chrome/ActionRegistry.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ActionCatalog, Actions } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Shortcuts } from './Shortcuts.svelte.js';

const BINDINGS = 'shortcuts.bindings';

const PROJECT = { id: 1, name: 'one', kind: 'folder' };

type Frame = (event: WatchedSettings) => void;

const watched = (key: string, value: unknown): WatchedSettings => ({ values: { [key]: value } }) as WatchedSettings;

function server() {
  const frames: Frame[] = [];
  const writes: unknown[] = [];
  let value: unknown = {};
  const live = {
    hold: (open: (client: unknown) => unknown, frame: Frame) => {
      open(new Proxy({}, { get: () => (payload: unknown) => payload }));
      frames.push(frame);
      queueMicrotask(() => frame(watched(BINDINGS, value)));
      return { unsubscribe: () => void frames.splice(frames.indexOf(frame), 1) };
    },
  };
  const door = {
    perform: async (operation: string, input: { readonly key: string; readonly value: unknown }) => {
      writes.push({ operation, ...input });
      value = input.value;
      for (const frame of frames) frame(watched(input.key, input.value));
      return { status: 'ok' };
    },
  };
  return { live, door, writes };
}

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.unmount();
});

function openWindow(world: ReturnType<typeof server>) {
  const opened: number[] = [];
  const shell = mountShell(
    Layer.mergeAll(
      Keymap,
      Shortcuts,
      ActionRegistry,
      Layer.provide(ActionRunner, function* () {
        return yield* ActionRegistry;
      }),
      Layer.provide(ActionCatalog, function* () {
        return yield* ActionRegistry;
      }),
      Notices,
      Actions,
      Actions.contribute('test', {
        id: 'test',
        area: 'Window',
        actions: [{ id: 'palette.open', title: 'Find or ask', keys: ['Mod+K'], run: () => void opened.push(1) }],
      }),
    ),
    Layer.mergeAll(
      Layer.of(Live, world.live as never),
      Layer.of(Door, world.door as never),
      Layer.of(Workspace, soloWorkspace({ contextProject: PROJECT, projects: [PROJECT] })),
      Layer.of(ShellKeys, { kept: [] }),
    ),
  );
  apps.push(shell);
  shell.get(ActionRegistry).attach(shell.app);
  return { shell, opened, shortcuts: shell.get(Shortcuts), keymap: shell.get(Keymap) };
}

const press = (keymap: Keymap, key: string, alt = false): void => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: keymap.mac,
      ctrlKey: !keymap.mac,
      altKey: alt,
      bubbles: true,
      cancelable: true,
    }),
  );
};

test('moving Find or ask to another chord writes the person layer, rebinds every label and press, and a second window follows', async () => {
  const world = server();
  const first = openWindow(world);
  const second = openWindow(world);
  await flush();
  const old = first.keymap.spellText('Mod+K');
  const moved = first.keymap.spellText('Mod+Alt+K');
  expect(first.keymap.spell('palette.open')).toBe(old);

  const chord = first.keymap.keysOf('palette.open')[0]!;
  await first.shortcuts.take('palette.open', { ...chord, alt: true }, false, 'replace');
  await flush();

  expect(world.writes).toEqual([
    { operation: 'write_setting_layer', scope: 'user', key: BINDINGS, value: { 'palette.open': [{ keys: 'Mod+Alt+K' }] } },
  ]);
  expect(first.keymap.spell('palette.open')).toBe(moved);
  expect(second.keymap.spell('palette.open')).toBe(moved);

  await apps.splice(apps.indexOf(second.shell), 1)[0]?.unmount();
  press(first.keymap, 'k');
  await flush();
  expect(first.opened).toEqual([]);
  press(first.keymap, 'k', true);
  await flush();
  expect(first.opened).toEqual([1]);
});
