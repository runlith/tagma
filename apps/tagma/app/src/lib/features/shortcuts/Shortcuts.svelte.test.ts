// @vitest-environment jsdom
import type { DesktopKeys as Bridge, WindowKeys } from '@tagma/desktop/bridge';
import type { WatchedSettings } from '@tagma/server/settings/contract/wire/feeds';
import type { HostInput } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import type { Router } from '@runlith/layer/Router';
import { makeRouter, makeRouterWithLog } from '@runlith/layer/testing';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, soloWorkspace, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { ActionRunner, ShellKeys } from '$lib/app/keys/ports.js';
import { ActionRegistry } from '$lib/app/chrome/ActionRegistry.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import PluginKeys from '$lib/features/plugins/Keys.svelte';
import { actions as dictation, HOLD } from '$lib/features/speech/dictation/action.js';
import { type Action, ActionCatalog, Actions } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { DesktopKeys } from '$lib/shared/desktop/DesktopKeys.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import ChordControl from './ChordControl.svelte';
import { rebindHref } from './href.js';
import Section from './Section.svelte';
import { Shortcuts } from './Shortcuts.svelte.js';

const BINDINGS = 'shortcuts.bindings';

const PROJECT = { id: 1, name: 'one', kind: 'folder' };

const BOARDS = { plugin: 'boards', title: 'Boards', rank: 0 };

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

function desktop() {
  const published: WindowKeys[] = [];
  const bridge: Bridge = {
    publish: (keys) => void published.push(keys),
    onPress: () => () => undefined,
    kept: async () => [],
    answers: async () => [],
    onAnswers: () => () => undefined,
  };
  return { bridge, globals: () => published.at(-1)?.global ?? [] };
}

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.unmount();
  document.body.replaceChildren();
});

type Stand = {
  readonly actions?: readonly Action[];
  readonly host?: HostInput;
  readonly bridge?: Bridge;
  readonly router?: Router;
};

function openWindow(world: ReturnType<typeof server>, stand: Stand = {}) {
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
        actions: [{ id: 'palette.open', title: 'Find or ask', keys: ['Mod+K'], run: () => void opened.push(1) }, ...(stand.actions ?? [])],
      }),
    ),
    Layer.mergeAll(
      Layer.of(Live, world.live as never),
      Layer.of(Door, world.door as never),
      Layer.of(Workspace, soloWorkspace({ contextProject: PROJECT, projects: [PROJECT] })),
      Layer.of(ShellKeys, { kept: [] }),
      ...(stand.bridge === undefined ? [] : [Layer.of(DesktopKeys, stand.bridge)]),
    ),
    { host: stand.host, router: stand.router },
  );
  apps.push(shell);
  shell.get(ActionRegistry).attach(shell.app);
  return { shell, opened, shortcuts: shell.get(Shortcuts), keymap: shell.get(Keymap) };
}

type Keys = { readonly key: string; readonly code: string; readonly mod?: boolean; readonly alt?: boolean };

const key = (keymap: Keymap, type: 'keydown' | 'keyup', keys: Keys): void => {
  const mod = keys.mod ?? true;
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key: keys.key,
      code: keys.code,
      metaKey: mod && keymap.mac,
      ctrlKey: mod && !keymap.mac,
      altKey: keys.alt ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
};

const press = (keymap: Keymap, letter: string, alt = false): void =>
  key(keymap, 'keydown', { key: letter, code: `Key${letter.toUpperCase()}`, alt });

const clicked = (root: HTMLElement, selector: string, words: string): void => {
  const button = [...root.querySelectorAll<HTMLButtonElement>(`${selector} button`)].find((one) => one.textContent?.trim() === words);
  if (button === undefined) throw new Error(`no "${words}" button in ${selector}`);
  button.click();
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

test('a chord pressed into one dictation control moves the key in every control, and holding the new chord dictates while the old one does not', async () => {
  const world = server();
  const shell = openWindow(world, { actions: dictation as readonly Action[] });
  await flush();
  const heard: string[] = [];
  shell.keymap.hold(HOLD, { press: () => void heard.push('press'), lift: () => void heard.push('lift') });
  const shortcuts = shell.shell.draw(ChordControl as never, { action: HOLD });
  const speech = shell.shell.draw(ChordControl as never, { action: HOLD, capturing: true });
  await flush();
  const before = shortcuts.querySelector('[data-chords]')?.textContent;

  key(shell.keymap, 'keydown', { key: 'd', code: 'KeyD', alt: true });
  await flush();

  expect(world.writes).toEqual([
    { operation: 'write_setting_layer', scope: 'user', key: BINDINGS, value: { [HOLD]: [{ keys: 'Mod+Alt+D' }] } },
  ]);
  const after = shortcuts.querySelector('[data-chords]')?.textContent;
  expect(after).not.toBe(before);
  expect(speech.querySelector('[data-chords]')?.textContent).toBe(after);

  const space = { key: ' ', code: 'Space', mod: false, alt: true };
  key(shell.keymap, 'keydown', space);
  key(shell.keymap, 'keyup', space);
  expect(heard).toEqual([]);
  key(shell.keymap, 'keydown', { key: 'd', code: 'KeyD', alt: true });
  key(shell.keymap, 'keyup', { key: 'd', code: 'KeyD', alt: true });
  expect(heard).toEqual(['press', 'lift']);
});

test("a plugin's chord Tagma holds stays unbound, its card names the holder, and Rebind opens Shortcuts capturing for that action", async () => {
  const world = server();
  const { router, visited } = makeRouterWithLog();
  const ran: number[] = [];
  const action: Action = { id: 'plugin.boards.open', title: 'Open boards', keys: ['Mod+K'], by: BOARDS, run: () => void ran.push(1) };
  const shell = openWindow(world, { actions: [action], router });
  await flush();
  const card = shell.shell.draw(PluginKeys as never, { plugin: 'boards' });
  await flush();

  expect(card.querySelector(`[data-displaced="${action.id}"]`)?.textContent).toContain('is taken by Find or ask');
  press(shell.keymap, 'k');
  await flush();
  expect([shell.opened, ran]).toEqual([[1], []]);

  clicked(card, `[data-displaced="${action.id}"]`, 'Rebind');
  await flush();
  expect(visited.map((one) => one.href)).toEqual([rebindHref(router, action.id)]);

  const settings = openWindow(world, { actions: [action], router: makeRouter({ url: new URL(visited[0]!.href, 'http://localhost') }) });
  await flush();
  const section = settings.shell.draw(Section as never, {});
  await flush();
  expect(section.querySelector(`[data-shortcut="${action.id}"] [data-capturing]`)).not.toBeNull();
});

test("on the desktop a plugin's chord asked for every app acts in Tagma alone until its card allows it, Only in Tagma takes it back, and dictation's global is published as a hold", async () => {
  const world = server();
  const shell = desktop();
  const ran: number[] = [];
  const action: Action = {
    id: 'plugin.boards.open',
    title: 'Open boards',
    keys: [{ keys: 'Mod+Alt+G', global: true }],
    by: BOARDS,
    run: () => void ran.push(1),
  };
  const window = openWindow(world, {
    actions: [action, ...(dictation as readonly Action[])],
    host: { kind: 'desktop', os: 'macos' },
    bridge: shell.bridge,
  });
  await flush();
  const card = window.shell.draw(PluginKeys as never, { plugin: 'boards' });
  await flush();

  press(window.keymap, 'g', true);
  await flush();
  expect(ran).toEqual([1]);
  expect(shell.globals()).toEqual([]);

  clicked(card, '[data-offered="asked"]', 'Work in every app');
  await flush();
  expect(world.writes.at(-1)).toEqual({
    operation: 'write_setting_layer',
    scope: 'user',
    key: BINDINGS,
    value: { [action.id]: [{ keys: 'Mod+Alt+G', global: true }] },
  });
  expect(shell.globals()).toEqual([{ chord: 'Alt+Cmd+G', action: action.id, hold: false }]);

  clicked(card, '[data-offered="allowed"]', 'Only in Tagma');
  await flush();
  expect(shell.globals()).toEqual([]);

  await window.shortcuts.everywhere(HOLD, window.keymap.keysOf(HOLD)[0]!, true);
  await flush();
  expect(shell.globals()).toEqual([{ chord: 'Alt+Space', action: HOLD, hold: true }]);
});
