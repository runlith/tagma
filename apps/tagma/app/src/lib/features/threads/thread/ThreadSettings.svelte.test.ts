// @vitest-environment jsdom

import type { FavoriteModels, ModelDefaultsWrite, RememberedSwitches } from '@tagma/server/native-harness/contract/wire/modelSelection';
import type { ModelPreference } from '@tagma/server/threads/contract/wire/birth';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';

import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { SHIPPED_SERVED } from '$lib/features/providers/testing.js';

const { defaultTextModelId, modelsFor } = modelCatalog(SHIPPED_SERVED);
import { Scope } from '@runlith/layer/Scope';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { stubMutation, stubSingle } from '@runlith/query/testing';
import { feedSnapshot, testLive, testThreadChat, testThreadSlot, commitRoute } from '$lib/app/slotWorld.js';
import type { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Favorites } from '../Favorites.svelte.js';
import * as modelCommands from '../native/commands/model.commands.js';
import { declaredCommand } from '../native/testing.js';
import type { ThreadSlot } from '../ThreadSlot.svelte.js';
import { ThreadSettings } from './ThreadSettings.svelte.js';

let host: ThreadSlot | null = null;
let favorites: Favorites | null = null;
let life: Scope | null = null;

const door = {
  defaults: vi.fn(),
  remembered: vi.fn(),
  saveDefaults: vi.fn(),
  setModelSettings: vi.fn(),
  favorites: vi.fn(),
  saveFavorites: vi.fn(),
};

afterEach(async () => {
  await life?.close();
  life = null;
  host = null;
  favorites = null;
  door.defaults.mockReset();
  door.remembered.mockReset();
  door.saveDefaults.mockReset();
  door.setModelSettings.mockReset();
  door.favorites.mockReset();
  door.saveFavorites.mockReset();
});

const account = (key: string, label: string, provider: string, isDefault = false) =>
  ({
    account: key,
    provider,
    label,
    origin: { kind: 'own' },
    default: isDefault,
    quota: null,
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    lent: [],
  }) as unknown as AccountQuotaRow;

function tableOf(rows: readonly AccountQuotaRow[]): UsageAccounts {
  const of = (provider: string) =>
    rows
      .filter((row) => row.provider === provider)
      .sort((left, right) => Number(right.default) - Number(left.default) || left.label.localeCompare(right.label));
  return { rows, known: rows.length > 0, providers: [], of, signing: of } as unknown as UsageAccounts;
}

const STORED = [
  account('k1', 'first@runlith.dev', 'subscription', true),
  account('k2', 'second@runlith.dev', 'subscription'),
  account('o1', 'codex@runlith.dev', 'openai-oauth', true),
];

const thread = (accountKey: string | null): WireThread =>
  ({
    id: 'thread-1',
    title: 'thread-1',
    parentThreadId: null,
    provider: 'subscription',
    account: accountKey,
    model: 'claude-opus-5-5',
    reasoning: null,
    switches: {},
    contextReading: null,
    authority: { mode: 'trust', bypassFrom: null },
    delegation: { own: null, allowed: true, setAt: null },
  }) as unknown as WireThread;

const defaults = (provider: string, accountKey: string | null, switches: Record<string, string> = {}): ModelPreference => ({
  account: accountKey,
  provider,
  model: provider === 'subscription' ? 'claude-opus-5-5' : 'gpt-5.6-sol',
  reasoning: null,
  switches,
});

const opening = (shown: WireThread) => feedSnapshot(shown);

async function open(row: WireThread | null, loaded = true): Promise<ThreadSlot> {
  life = Scope.make();
  if (door.favorites.getMockImplementation() === undefined) door.favorites.mockResolvedValue({ models: [] });
  const port = new TestConnection<WireThread>();
  const threads = {
    defaults: stubSingle({
      loadOrThrow: async () => ({
        status: 'read' as const,
        defaults: (await door.defaults()) as ModelPreference,
        remembered: (door.remembered() as RememberedSwitches | undefined) ?? {},
      }),
    }),
    setDefaults: stubMutation(door.saveDefaults),
    favorites: stubSingle({ loadOrThrow: door.favorites }),
    setFavorites: stubMutation(door.saveFavorites),
  };
  favorites = new Favorites(threads as never, new Notices(life), life);
  host = testThreadSlot(
    {
      projectId: 1,
      accounts: tableOf(STORED),
      threads,
      favorites,
      live: testLive({ model: (params, at) => Effect.promise(() => door.setModelSettings(params, at) as Promise<unknown>) }),
      chat: testThreadChat(port),
    },
    {},
    life,
  );
  if (row) {
    host.open(row.id);
    commitRoute(host);
    if (!loaded) return host;
    port.emit(opening(row), row.id);
    await waitUntil(() => host?.activeThread != null);
  }
  await waitUntil(() => host?.views.model.settings != null);
  return host;
}

test('the picker shows the thread’s own account, and choosing another leaves the owner default where it is', async () => {
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.saveDefaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.setModelSettings.mockResolvedValue({ status: 'ok' });

  const opened = await open(thread('k1'));
  expect(opened.views.model.settings?.account).toBe('k1');
  expect(opened.views.model.settings?.accountOptions.map((option) => option.label)).toEqual(['first@runlith.dev', 'second@runlith.dev']);
  expect(opened.views.model.accountLabel).toBe('first@runlith.dev');

  await opened.writes.applyAccount('k2');

  expect(opened.views.model.settings?.account).toBe('k2');
  expect(opened.views.model.accountLabel).toBe('second@runlith.dev');
  const written = door.saveDefaults.mock.calls.at(-1)?.[0] as ModelPreference;
  expect(written.account).toBeNull();
  expect(written.provider).toBe('subscription');
});

test('a thread pinned to an account that is gone keeps naming it', async () => {
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));

  const opened = await open(thread('removed-key'));

  expect(opened.views.model.settings?.account).toBe('removed-key');
  expect(opened.views.model.settings?.accountMissing).toBe(true);
  expect(opened.views.model.accountLabel).toBe('removed-key');
});

test('a thread whose feed has not loaded shows no account choice instead of the global default', async () => {
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));

  const opened = await open(thread('k2'), false);
  await waitUntil(() => door.defaults.mock.results.length > 0);
  await Promise.all([door.defaults.mock.results[0]?.value, Promise.resolve()]);
  await Promise.resolve();

  expect(opened.activeThread).toBeNull();
  expect(opened.views.model.settings).toBeNull();
});

test('a draft shows the provider’s default, and a row of another provider shows that provider’s', async () => {
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.saveDefaults.mockResolvedValue(defaults('openai-oauth', 'o1'));

  const opened = await open(null);
  expect(opened.views.model.settings?.account).toBe('k1');
  expect(opened.views.model.settings?.accountPinned).toBe(false);
  expect(opened.views.model.settings?.accountMissing).toBe(false);

  await opened.writes.applyModel('openai-oauth', defaultTextModelId('openai-oauth'));

  expect(opened.views.model.settings?.provider).toBe('openai-oauth');
  expect(opened.views.model.settings?.account).toBe('o1');
  expect(opened.views.model.settings?.accountPinned).toBe(false);
  expect(opened.views.model.settings?.accountOptions.map((option) => option.id)).toEqual(['o1']);
});

it.live(
  '/model and /reasoning open the model panel, a row picked there lands its model and rung in one write, and both print the current choice',
  () =>
    Effect.gen(function* () {
      door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
      door.saveDefaults.mockImplementation((write: ModelDefaultsWrite) => Promise.resolve({ ...write, switches: write.switches ?? {} }));
      door.setModelSettings.mockResolvedValue({ status: 'ok' });

      const opened = yield* Effect.promise(() => open({ ...thread('k1'), reasoning: 'high' } as WireThread));
      const command = (name: 'model' | 'reasoning') => declaredCommand(modelCommands.commands, name, opened);
      expect(command('model')?.value).toBe('Opus 5.5');
      expect(command('reasoning')?.value).toBe('High');
      yield* command('model')!.run({ gesture: 'send', query: 'sol' });
      expect(opened.panel.current).toMatchObject({ mode: 'model', query: 'sol' });
      yield* command('reasoning')!.run({ gesture: 'send', query: '' });
      expect(opened.panel.current).toMatchObject({ mode: 'model', query: '' });
      expect(opened.views.model.modelList?.current).toBe('subscription:claude-opus-5-5');

      const sol = opened.views.model.modelList?.choices.find((choice) => choice.label === 'GPT-5.6 Sol');
      if (!sol) return yield* Effect.die('the OpenAI subscription rows are not offered');
      expect(sol.ladder.map((step) => step.id)).toContain(sol.rung);
      yield* Effect.promise(() => opened.writes.applyModel(sol.provider, sol.model, sol.rung));
      expect(door.setModelSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: 'openai-oauth', model: 'gpt-5.6-sol', account: null, reasoning: sol.rung }),
        expect.anything(),
      );
      expect(command('model')?.value).toBe('GPT-5.6 Sol');

      const own = opened.views.model.modelList?.choices.find(
        (choice) => `${choice.provider}:${choice.model}` === opened.views.model.modelList?.current,
      );
      const rung = own?.ladder.find((step) => step.id !== own.rung);
      if (!own || !rung) return yield* Effect.die('the row offers one rung alone');
      yield* Effect.promise(() => opened.writes.applyModel(own.provider, own.model, rung.id));
      expect(opened.views.model.settings?.reasoning).toBe(rung.id);
      expect(command('reasoning')?.value).toBe(opened.views.model.settings?.reasoningLabel);
      expect(opened.views.model.settings?.reasoningShort).toBe(rung.short);
    }),
);

test('a star appends in pin order, removal keeps the rest, an unoffered pair is kept but not drawn, and the model list leads with the favorites', async () => {
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.favorites.mockResolvedValue({
    models: [
      { provider: 'openai-oauth', model: 'gpt-5.6-sol' },
      { provider: 'subscription', model: 'claude-gone' },
    ],
  });
  door.saveFavorites.mockImplementation((favorites: FavoriteModels) => Promise.resolve(favorites));

  const opened = await open(null);
  await waitFor(() => expect(favorites!.list).toHaveLength(2));
  expect(opened.views.model.settings?.favorites.map((row) => `${row.provider}:${row.id}`)).toEqual(['openai-oauth:gpt-5.6-sol']);

  await favorites!.toggle('subscription', 'claude-opus-5-5');
  expect(door.saveFavorites).toHaveBeenLastCalledWith(
    {
      models: [
        { provider: 'openai-oauth', model: 'gpt-5.6-sol' },
        { provider: 'subscription', model: 'claude-gone' },
        { provider: 'subscription', model: 'claude-opus-5-5' },
      ],
    },
    expect.anything(),
  );
  expect(opened.views.model.settings?.favorites.map((row) => row.label)).toEqual(['GPT-5.6 Sol', 'Opus 5.5']);

  const pinned = ['openai-oauth:gpt-5.6-sol', 'subscription:claude-opus-5-5'];
  expect(opened.views.model.modelList?.starred).toEqual(pinned);
  expect(opened.views.model.modelList?.lead.map((section) => [section.id, section.keys])).toEqual([['favorites', pinned]]);

  await favorites!.toggle('openai-oauth', 'gpt-5.6-sol');
  expect(door.saveFavorites).toHaveBeenLastCalledWith(
    {
      models: [
        { provider: 'subscription', model: 'claude-gone' },
        { provider: 'subscription', model: 'claude-opus-5-5' },
      ],
    },
    expect.anything(),
  );
  expect(opened.views.model.settings?.favorites.map((row) => row.label)).toEqual(['Opus 5.5']);
});

test('a favorite dropped before another takes its place, one dropped past the end goes last, and a failed save restores the order', async () => {
  const a = { provider: 'openai-oauth', model: 'gpt-5.6-sol' };
  const b = { provider: 'subscription', model: 'claude-opus-5-5' };
  const c = { provider: 'subscription', model: 'claude-gone' };
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.favorites.mockResolvedValue({ models: [a, b, c] });
  door.saveFavorites.mockImplementation((favorites: FavoriteModels) => Promise.resolve(favorites));

  const opened = await open(null);
  await waitFor(() => expect(favorites!.list).toHaveLength(3));

  await favorites!.move(c, a);
  expect(door.saveFavorites).toHaveBeenLastCalledWith({ models: [c, a, b] }, expect.anything());
  expect(favorites!.list).toEqual([c, a, b]);

  await favorites!.move(c, null);
  expect(favorites!.list).toEqual([a, b, c]);

  door.saveFavorites.mockRejectedValueOnce(new Error('offline'));
  await favorites!.move(a, null);
  expect(favorites!.list).toEqual([a, b, c]);
});

test('a picked switch reaches the owner door, stands on the next draft and is found again after a provider round trip', async () => {
  const remembered: Record<string, Record<string, string>> = {};
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.saveDefaults.mockImplementation((write: ModelDefaultsWrite) => {
    const key = `${write.provider}:${write.model}`;
    if (write.switches !== undefined) remembered[key] = write.switches;
    return Promise.resolve({ ...write, account: null, switches: remembered[key] ?? {} });
  });
  door.setModelSettings.mockResolvedValue({ status: 'ok' });

  const row = modelsFor('subscription', 'text').find((option) => option.switches.length > 0);
  const declared = row?.switches[0];
  const on = declared?.values.find((value) => value.id !== declared.default)?.id;
  if (!row || !declared || !on) throw new Error('the Anthropic subscription table declares no switch');
  const drawn = (host: ThreadSlot): string | null | undefined =>
    host.views.model.settings?.switches.find((option) => option.id === declared.id)?.value;

  const opened = await open({ ...thread('k1'), model: row.id } as WireThread);
  expect(drawn(opened)).not.toBe(on);
  await opened.writes.applySwitch(declared.id, on);
  expect(remembered[`subscription:${row.id}`]).toEqual({ [declared.id]: on });

  await opened.writes.applyModel('openai-oauth', 'gpt-5.6-sol');
  expect(drawn(opened)).toBeUndefined();
  await opened.writes.applyModel('subscription', row.id);
  expect(door.setModelSettings.mock.calls.at(-1)?.[0]).toMatchObject({ switches: { [declared.id]: on } });
  expect(drawn(opened)).toBe(on);

  opened.startDraft();
  commitRoute(opened);
  expect(drawn(opened)).toBe(on);
});

test('a row of another model lands provider, model, a legal rung and that model’s own switches in one write', async () => {
  door.defaults.mockResolvedValue(defaults('openai-oauth', 'o1'));
  door.saveDefaults.mockImplementation((write: ModelDefaultsWrite) => Promise.resolve({ ...write, switches: write.switches ?? {} }));
  door.setModelSettings.mockResolvedValue({ status: 'ok' });

  const rows = modelsFor('openai-oauth', 'text');
  const withSwitch = rows.find((option) => option.switches.length > 0);
  const declared = withSwitch?.switches[0];
  const on = declared?.values[1]?.id;
  if (!withSwitch || !declared || !on) throw new Error('the OpenAI subscription table declares no switch with a second value');
  const alsoDeclaring = rows.find(
    (option) => option.id !== withSwitch.id && option.switches.some((switched) => switched.id === declared.id),
  );
  if (!alsoDeclaring) throw new Error('only one row of the OpenAI subscription declares its switch');

  const opened = await open({
    ...thread(null),
    provider: 'openai-oauth',
    model: withSwitch.id,
    reasoning: 'high',
  } as WireThread);
  await opened.writes.applySwitch(declared.id, on);
  expect(opened.views.model.settings?.switches.find((option) => option.id === declared.id)?.value).toBe(on);

  await opened.writes.applyModel('openai-oauth', alsoDeclaring.id);
  expect(door.setModelSettings).toHaveBeenLastCalledWith(
    expect.objectContaining({ provider: 'openai-oauth', model: alsoDeclaring.id, switches: {} }),
    expect.anything(),
  );

  door.setModelSettings.mockClear();
  await opened.writes.applyModel('subscription', 'claude-opus-5-5');
  expect(door.setModelSettings).toHaveBeenCalledTimes(1);
  const written = door.setModelSettings.mock.calls[0]?.[0] as ModelPreference & { switches: Record<string, string> };
  expect(written).toMatchObject({ provider: 'subscription', model: 'claude-opus-5-5', account: null, switches: {} });
  const rungs = modelsFor('subscription', 'text').find((option) => option.id === 'claude-opus-5-5')?.reasoningOptions ?? [];
  expect(rungs.map((rung) => rung.id)).toContain(written.reasoning);
  expect(opened.views.model.settings?.provider).toBe('subscription');
  expect(opened.views.model.settings?.account).toBe('k1');
});

test('a row of another provider shows the switch its model keeps, and a switch set on the row lands with the account in one write and stays with that model', async () => {
  const model = modelsFor('openai-oauth', 'text').find((option) => option.switches.some((one) => one.icon !== undefined));
  const declared = model?.switches.find((one) => one.icon !== undefined);
  const [off, on] = declared?.values ?? [];
  if (!model || !declared || !off || !on) throw new Error('no OpenAI subscription row declares an iconed switch');
  const memory: Record<string, Record<string, Record<string, string>>> = { 'openai-oauth': { [model.id]: { [declared.id]: on.id } } };
  door.defaults.mockResolvedValue(defaults('subscription', 'k1'));
  door.remembered.mockImplementation(() => memory);
  door.saveDefaults.mockImplementation((write: ModelDefaultsWrite) => {
    const own = (memory[write.provider] ??= {});
    if (write.switches !== undefined) own[write.model] = { ...write.switches };
    return Promise.resolve({ ...write, account: null, switches: own[write.model] ?? {} });
  });
  door.setModelSettings.mockResolvedValue({ status: 'ok' });

  const opened = await open(thread('k1'));
  const row = opened.views.model.modelList?.choices.find((choice) => choice.provider === 'openai-oauth' && choice.model === model.id);
  expect(row?.toggles?.find((toggle) => toggle.id === declared.id)?.value).toBe(on.id);

  await opened.writes.applyModel('openai-oauth', model.id, row?.rung, { switches: { [declared.id]: off.id }, account: 'o1' });

  expect(door.setModelSettings).toHaveBeenLastCalledWith(
    expect.objectContaining({ provider: 'openai-oauth', model: model.id, account: 'o1', switches: { [declared.id]: off.id } }),
    expect.anything(),
  );
  expect(memory['openai-oauth']?.[model.id]).toEqual({ [declared.id]: off.id });
});

it.live(
  'settings writes arrive in the order of intent, the ones between collapse into the last, and a slot that moves on writes nothing into the new thread',
  () =>
    Effect.gen(function* () {
      const row = modelsFor('openai-oauth', 'text').find((option) => option.switches.length > 0);
      const declared = row?.switches[0];
      const [off, on] = declared?.values ?? [];
      if (!row || !declared || !off || !on) return yield* Effect.die('the OpenAI subscription table declares no two-valued switch');
      const first = Promise.withResolvers<unknown>();
      const calls: { threadId: string; switches: unknown }[] = [];
      door.defaults.mockResolvedValue(defaults('openai-oauth', 'o1'));
      door.saveDefaults.mockImplementation((write: ModelDefaultsWrite) => Promise.resolve({ ...write, switches: write.switches ?? {} }));
      door.setModelSettings.mockImplementation((params: { switches: unknown }, at: { threadId: string }) => {
        calls.push({ threadId: at.threadId, switches: params.switches });
        return calls.length === 1 ? first.promise : Promise.resolve({});
      });
      const opened = yield* Effect.promise(() => open({ ...thread(null), provider: 'openai-oauth', model: row.id } as WireThread));
      const settings = opened.thread?.get(ThreadSettings);
      if (!settings) return yield* Effect.die('the open thread holds no settings');

      const writes = [yield* Effect.forkScoped(settings.chooseSwitch(declared.id, on.id))];
      yield* Effect.promise(() => waitFor(() => expect(calls).toHaveLength(1)));
      writes.push(
        yield* Effect.forkScoped(settings.chooseSwitch(declared.id, off.id)),
        yield* Effect.forkScoped(settings.chooseSwitch(declared.id, on.id)),
      );
      first.resolve({});
      yield* Effect.forEach(writes, Fiber.join);

      expect(calls.map((call) => call.switches)).toEqual([{ [declared.id]: on.id }, { [declared.id]: on.id }]);

      const slow = Promise.withResolvers<unknown>();
      door.setModelSettings.mockImplementationOnce((params: { switches: unknown }, at: { threadId: string }) => {
        calls.push({ threadId: at.threadId, switches: params.switches });
        return slow.promise;
      });
      const leaving = yield* Effect.forkScoped(Effect.exit(settings.chooseSwitch(declared.id, off.id)));
      yield* Effect.promise(() => waitFor(() => expect(calls).toHaveLength(3)));
      opened.open('thread-2');
      commitRoute(opened);
      slow.resolve({});
      const left = yield* Fiber.join(leaving);
      expect(Exit.isFailure(left) && Cause.hasInterruptsOnly(left.cause)).toBe(true);
      expect(calls.every((call) => call.threadId === 'thread-1')).toBe(true);
      expect(opened.thread?.threadId).toBe('thread-2');
    }),
);
