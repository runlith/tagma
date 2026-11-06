// @vitest-environment jsdom
import { settingKey } from '@tagma/server/platform/contract/wire/setting';
import { Layer } from '@runlith/layer/Layer';
import { Schema } from 'effect';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveFailure } from '$lib/wire/Live.js';
import { Refusal } from '$lib/wire/refusal.js';
import { UserSettings } from './UserSettings.svelte.js';

type Frame = (event: { readonly values: Record<string, unknown> }) => void;

const THEME = settingKey({
  id: 'look.theme',
  order: 1,
  title: 'Theme',
  description: 'The person’s theme.',
  schema: Schema.String,
  fallback: 'tagma',
  scopes: ['user'],
  merge: 'replace',
});

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.unmount();
});

function window(write: (value: unknown, tell: (value: unknown) => void) => Promise<unknown>, refused?: LiveFailure) {
  const frames: Frame[] = [];
  const tell = (value: unknown): void => {
    for (const frame of frames) frame({ values: { [THEME.id]: value } });
  };
  const live = {
    hold: (_open: unknown, frame: Frame, failed: (failure: LiveFailure) => void) => {
      frames.push(frame);
      queueMicrotask(() => (refused === undefined ? frame({ values: { [THEME.id]: 'tagma' } }) : failed(refused)));
      return { unsubscribe: () => void frames.splice(frames.indexOf(frame), 1) };
    },
  };
  const door = { perform: (_operation: string, input: { readonly value: unknown }) => write(input.value, tell) };
  const shell = mountShell(
    Layer.mergeAll(UserSettings, Notices),
    Layer.mergeAll(Layer.of(Live, live as never), Layer.of(Door, door as never)),
  );
  apps.push(shell);
  return { setting: shell.get(UserSettings).of(THEME), notices: shell.get(Notices), tell };
}

const refusal = () => new Refusal({ code: 'setting-value', reason: 'refused', unblock: [], gate: true });

test('a refused write drops only its own edit and keeps the newer value the feed confirmed meanwhile', async () => {
  let refuse: () => void = () => undefined;
  const { setting, notices, tell } = window(
    () =>
      new Promise((_done, failed) => {
        refuse = () => failed(refusal());
      }),
  );
  await flush();

  const writing = setting.write('nord.nord');
  expect(setting.value).toBe('nord.nord');
  tell('dracula.dracula');
  refuse();
  await writing;

  expect(setting.value).toBe('dracula.dracula');
  expect(notices.list.map((notice) => notice.title)).toEqual(['setting-value']);
});

test('a write the server committed whose answer was lost settles on the committed value', async () => {
  const { setting } = window(async (value, tell) => {
    tell(value);
    throw new Error('the answer was lost');
  });
  await flush();

  await setting.write('nord.nord');

  expect(setting.value).toBe('nord.nord');
});

test('a refused watch leaves the setting unknown and says why', async () => {
  const { setting, notices } = window(async () => ({ status: 'written' }), {
    kind: 'subscription',
    message: 'No setting is declared under appearance.theme.',
    code: 'unknown-setting',
    unblock: ['name a declared key'],
  });
  await flush();

  expect(setting.known).toBe(false);
  expect(setting.problem).toBe('No setting is declared under appearance.theme. — name a declared key');
  expect(notices.faults.map((fault) => fault.title)).toEqual(['unknown-setting']);
});
