// @vitest-environment jsdom
import { QueryClient } from '@tanstack/query-core';
import { mountRepo, stubFamily, stubMutation } from '@runlith/query/testing';
import { tick } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { EXECUTION_SETTING_KEYS as SETTING_KEYS } from '@tagma/server/executions/settings';
import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import { TerminalAppearance, type AppearancePane } from './Settings.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { terminalThemeDark, terminalThemeLight } from '@tagma/server/executions/contract/wire/terminalAppearance';
import { resolve } from '@tagma/server/appearance/contract/wire/resolve';
import { catalogTheme } from '$lib/shared/terminalThemes.js';
import type { Look, ThemeMode } from '$lib/shared/Theme.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';

await loadCatalog();

function catalog(over: Record<string, unknown> = {}): SettingEntry[] {
  return SETTING_KEYS.filter((key) => key.section === 'terminal').map((key) => ({
    id: key.id,
    section: key.section,
    title: key.title,
    description: key.description,
    shape: '',
    scopes: key.scopes,
    merge: key.merge,
    value: over[key.id] ?? key.fallback,
    from: 'default',
    fallback: key.fallback,
    layers: {},
  }));
}

function pane(id = 'pane-1'): AppearancePane & { options: ITerminalOptions; themes: ITheme[]; box: boolean; fits: number } {
  const recorded: AppearancePane & { options: ITerminalOptions; themes: ITheme[]; box: boolean; fits: number } = {
    id,
    options: {},
    themes: [],
    box: true,
    fits: 0,
    applyOptions(next) {
      this.options = { ...this.options, ...next };
    },
    applyTheme(theme) {
      this.themes.push(theme);
      this.options = { ...this.options, theme };
    },
    hasBox() {
      return this.box;
    },
    fit() {
      this.fits += 1;
    },
  };
  return recorded;
}

type Written = { projectId: number; settings: { entries: SettingEntry[]; sections: never[]; rejections: never[] } };

async function appearance(
  entries: () => SettingEntry[],
  answered: () => boolean = () => true,
  written: () => Written | undefined = () => undefined,
): Promise<{ owner: TerminalAppearance; stop: () => void }> {
  const answer = (): { entries: SettingEntry[]; sections: never[]; rejections: never[] } | undefined =>
    answered() ? { entries: entries(), sections: [], rejections: [] } : undefined;
  const repo = {
    catalog: stubFamily({
      get data() {
        return answer();
      },
      refresh: async () => answer(),
    }),
    write: {
      ...stubMutation(),
      get data() {
        return written();
      },
    },
  };
  const workspace = { contextProject: { id: 1 } };
  let owner!: TerminalAppearance;
  const stop = $effect.root(() => {
    owner = new TerminalAppearance(repo as never, workspace as never, theme as never);
  });
  await tick();
  return { owner, stop };
}

const lookOf = (mode: ThemeMode): Look => ({ id: 'tagma', mode, terminal: resolve(undefined, mode).terminal });

const theme: { look: Look } = { look: lookOf('dark') };

const close: (() => void)[] = [];
afterEach(() => {
  for (const release of close.splice(0)) release();
  theme.look = lookOf('dark');
});

test('two applies with an equal theme write options.theme once', async () => {
  const { owner, stop } = await appearance(() => catalog());
  close.push(stop);
  const target = pane();
  close.push(owner.register(target));
  expect(target.themes).toHaveLength(1);
  owner.apply(target);
  expect(target.themes).toHaveLength(1);
  expect(target.options.theme).toBe(target.themes[0]);
});

test('a changed colour override writes a new theme', async () => {
  let entries = catalog();
  const { owner, stop } = await appearance(() => entries);
  close.push(stop);
  const target = pane();
  close.push(owner.register(target));
  const first = target.options.theme;
  entries = catalog({ 'terminal.colorOverrides': { background: '#102030' } });
  await owner.refresh();
  expect(target.options.theme).not.toBe(first);
  expect(target.options.theme?.background).toBe('#102030ff');
});

test('clearing the word separator reaches a live pane, where xterm restores its own default', async () => {
  let entries = catalog({ 'terminal.wordSeparator': '/' });
  const { owner, stop } = await appearance(() => entries);
  close.push(stop);
  const target = pane();
  close.push(owner.register(target));
  expect(target.options.wordSeparator).toBe('/');

  entries = catalog();
  await owner.refresh();
  expect(target.options.wordSeparator).toBe('');
});

test('metric options on a pane with no box are parked until it has one', async () => {
  const { owner, stop } = await appearance(() => catalog({ 'terminal.fontSize': 16 }));
  close.push(stop);
  const target = pane();
  target.box = false;
  close.push(owner.register(target));
  expect(target.options.fontSize).toBeUndefined();
  expect(owner.parked(target)?.fontSize).toBe(16);
  target.box = true;
  owner.apply(target);
  expect(target.options.fontSize).toBe(16);
  expect(owner.parked(target)).toBeUndefined();
});

test('font zoom is one pane\u2019s own, clamped to 8\u201332 px \u2014 useTerminalFontZoom.ts:27-29', async () => {
  const { owner, stop } = await appearance(() => catalog({ 'terminal.fontSize': 14 }));
  close.push(stop);
  const target = pane('pane-1');
  const sibling = pane('pane-2');
  close.push(owner.register(target));
  close.push(owner.register(sibling));

  for (let step = 0; step < 20; step += 1) owner.zoom(target, 1);
  expect(target.options.fontSize).toBe(32);
  expect(sibling.options.fontSize).toBe(14);
  for (let step = 0; step < 40; step += 1) owner.zoom(target, -1);
  expect(target.options.fontSize).toBe(8);
  expect(sibling.options.fontSize).toBe(14);

  owner.resetZoom(target);
  expect(target.options.fontSize).toBe(14);
  expect(target.fits).toBeGreaterThan(0);
});

test('the renderer and keymap readers answer the section values', async () => {
  const { owner, stop } = await appearance(() =>
    catalog({
      'terminal.gpuAcceleration': 'off',
      'terminal.shortcutPolicy': 'terminal-first',
      'terminal.macOptionAsAlt': 'left',
      'terminal.tuiScrollSensitivity': 3,
      'terminal.allowOsc52Clipboard': false,
      'terminal.clipboardOnSelect': true,
      'terminal.rightClickToPaste': true,
    }),
  );
  close.push(stop);
  expect(owner.webgl()).toBe('off');
  expect(owner.keymapPolicy()).toBe('terminal-first');
  expect(owner.macOptionAsAlt()).toBe('left');
  expect(owner.wheelSensitivity()).toBe(3);
  expect(owner.osc52()).toBe(false);
  expect(owner.clipboardOnSelect()).toBe(true);
  expect(owner.rightClickToPaste()).toBe(true);
  expect(owner.ligaturesOn()).toBe(false);
});

test('options() answers the engine input for the pane', async () => {
  const { owner, stop } = await appearance(() => catalog({ 'terminal.fontSize': 16 }));
  close.push(stop);
  const input = owner.options('pane-1');
  expect(input.fontSize).toBe(16);
  expect(input.surface).toBe('dark');
  expect(input.theme?.background).toBe(owner.theme().background);
});

test('the terminal’s default palette is the window theme’s own terminal palette in the shown mode', async () => {
  theme.look = { id: 'nord.nord', mode: 'light', terminal: { ...lookOf('light').terminal, background: '#eceff4', red: '#bf616a' } };
  const { owner, stop } = await appearance(() => catalog());
  close.push(stop);
  expect(owner.theme()).toMatchObject({ background: '#eceff4ff', red: '#bf616a' });
});

test('the terminal offers Same as the theme first, as both slots’ default, then palettes the catalogue holds', async () => {
  const { owner, stop } = await appearance(() => catalog());
  close.push(stop);
  const [first, ...rest] = owner.entries;
  expect(first).toMatchObject({ value: terminalThemeDark.fallback, label: 'Same as the theme' });
  expect(terminalThemeLight.fallback).toBe(terminalThemeDark.fallback);
  for (const entry of rest) expect(catalogTheme(entry.value), `${entry.value} is offered and not held`).toBeDefined();
});

test('the box stands in the page ground until the settings answer, and takes the composed fill after', async () => {
  let answered = false;
  const { owner, stop } = await appearance(
    () => catalog({ 'terminal.colorOverrides': { background: '#102030' } }),
    () => answered,
  );
  close.push(stop);
  expect(owner.known).toBe(false);
  expect(owner.paneFill).toBe('var(--color-background)');
  expect(owner.paneBackground).toBe('var(--color-background)');

  answered = true;
  await owner.refresh();
  const target = pane();
  close.push(owner.register(target));
  expect(owner.known).toBe(true);
  expect(owner.paneFill).toBe('#102030ff');
});

test('a write another project answered leaves this project’s look, and one this project answered lands', async () => {
  const overridden = (background: string): Written['settings'] => ({
    entries: catalog({ 'terminal.colorOverrides': { background } }),
    sections: [],
    rejections: [],
  });
  let written = $state<Written | undefined>(undefined);
  const { owner, stop } = await appearance(
    () => overridden('#102030').entries,
    () => true,
    () => written,
  );
  close.push(stop);
  close.push(owner.register(pane()));
  expect(owner.paneFill).toBe('#102030ff');

  written = { projectId: 2, settings: overridden('#405060') };
  await tick();
  expect(owner.paneFill).toBe('#102030ff');

  written = { projectId: 1, settings: overridden('#405060') };
  await tick();
  expect(owner.paneFill).toBe('#405060ff');
});

test('a project whose catalog nobody holds yet is asked for once, and its look lands when that one answers', async () => {
  const asked: string[] = [];
  const requested = Promise.withResolvers<void>();
  let answer!: (response: Response) => void;
  const answered = new Promise<Response>((resolve) => (answer = resolve));
  const door = testDoor((input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(new Request(input, init).url);
    requested.resolve();
    return answered;
  });
  const mounted = mountRepo(SettingsRepo, { door, queryClient: new QueryClient() });
  close.push(() => void mounted.unmount());
  let owner!: TerminalAppearance;
  close.push(
    $effect.root(() => {
      owner = new TerminalAppearance(mounted.repo, { contextProject: { id: 7 } } as never, theme as never);
    }),
  );

  await requested.promise;
  expect(asked).toHaveLength(1);
  const text = JSON.stringify({ status: 'ok', project: { id: 7, name: 'demo' }, settings: { sections: [], entries: [], rejections: [] } });
  answer(new Response(text, { headers: { 'content-type': 'application/json' } }));
  await waitUntil(() => owner.known);
  expect(asked).toHaveLength(1);
});
