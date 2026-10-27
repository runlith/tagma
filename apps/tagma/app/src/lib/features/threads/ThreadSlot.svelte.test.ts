// @vitest-environment jsdom

import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { HARNESS_AGENT_ID } from '@tagma/server/threads/contract/wire/harness/names';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { ThreadTypesPage } from '@tagma/server/threads/contract/wire/birth';
import type { ThreadInstructionsRefreshed } from '@tagma/server/native-harness/contract/wire/instructions';
import type { CompactionChoice, CompactionChoicesRead } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import { ChatCommandRefused, type ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { Effect, Fiber } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';

import type { PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { makeStorage } from '@runlith/layer/testing';
import { stubFamily, stubMutation } from '@runlith/query/testing';
import { feedSnapshot, testLive, testThreadChat, testThreadSlot, testThreadSlots, commitRoute, routeOf } from '$lib/app/slotWorld.js';
import { testShelf } from './native/testing.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { agentCommand } from './native/commands/agent.commands.js';
import { compactCommand } from './native/commands/compact.commands.js';
import { delegationCommand } from './native/commands/delegation.commands.js';
import { modeCycle } from './native/commands/mode.commands.js';
import { recapCommand } from './native/commands/recap.commands.js';
import { refreshInstructionsCommand } from './native/commands/refreshInstructions.commands.js';
import type { DraftShelf } from './native/DraftShelf.svelte.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';
import { ThreadCompaction } from './thread/ThreadCompaction.svelte.js';
import { Refusal } from '$lib/wire/refusal.js';

const door = {
  create: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  types: vi.fn<() => Promise<ThreadTypesPage>>(),
  refresh: vi.fn<() => Promise<ThreadInstructionsRefreshed>>(),
};

let slot: ThreadSlot | null = null;
let life: Scope | null = null;
let port = new TestConnection<WireThread>();

type Over = {
  shelf?: DraftShelf;
  storage?: PlatformStorage;
  settings?: unknown;
  threads?: Record<string, unknown>;
  list?: unknown;
  accounts?: unknown;
  live?: LiveConnection;
};

function open(over: Over = {}): ThreadSlot {
  life = Scope.make();
  slot = testThreadSlot(
    {
      projectId: 47,
      chat: testThreadChat(port),
      shelf: over.shelf,
      storage: over.storage,
      settings: over.settings as never,
      list: over.list as never,
      accounts: over.accounts as never,
      live: over.live,
      threads: {
        create: stubMutation(door.create),
        upload: stubMutation(door.upload),
        remove: stubMutation(door.remove),
        types: stubMutation(door.types),
        refreshInstructions: stubMutation(door.refresh),
        ...over.threads,
      },
    },
    {},
    life,
  );
  return slot;
}

const opened = (over: Partial<WireThread> = {}): WireThread =>
  ({
    id: 'thread-1',
    title: 'thread-1',
    parentThreadId: null,
    provider: 'openai-oauth',
    account: null,
    model: 'test',
    reasoning: null,
    switches: {},
    contextReading: null,
    authority: { mode: 'trust', bypassFrom: null },
    delegation: { own: null, allowed: true, setAt: null },
    ...over,
  }) as unknown as WireThread;

async function shows(id: string, thread: WireThread = opened({ id }), modes?: ThreadModes): Promise<void> {
  slot?.open(id);
  slot && commitRoute(slot);
  port.emit(feedSnapshot(thread, null, modes), id);
  await waitUntil(() => slot?.chat.session?.thread?.id === id);
}

afterEach(async () => {
  await life?.close();
  life = null;
  slot = null;
  port = new TestConnection<WireThread>();
  door.create.mockReset();
  door.upload.mockReset();
  door.remove.mockReset();
  door.types.mockReset();
  door.refresh.mockReset();
});

const settingsSaying = (mode: string) => ({
  reloadSources: stubMutation(),
  catalog: stubFamily({ data: { sections: [], rejections: [], entries: [{ id: 'agent.approvalMode', value: mode }] } }),
});

test('a terminal child retains its foreign parent address while the chat surface is hidden', async () => {
  const parent = { id: 'parent', projectId: 7, title: 'Read the module' };
  const row = { id: 'thread-1', title: 'child', parentThreadId: parent.id, agentId: HARNESS_AGENT_ID } as ThreadListRow;
  const host = open({ list: { threads: [row], row: (id: string) => (id === row.id ? row : undefined) } });
  await shows(
    row.id,
    opened({
      agentId: HARNESS_AGENT_ID,
      parentThreadId: parent.id,
      parent,
      capabilities: { ...NATIVE_CAPABILITIES, screen: true },
      harness: { process: { state: 'running' } } as WireThread['harness'],
    }),
  );
  expect(host.surface.kind).toBe('terminal');
  expect(host.activeThread).toBeNull();
  expect(host.identity?.parent).toEqual(parent);
});

test('the composer recalls the prompts this project sent, from the record its own key names', () => {
  open({ storage: makeStorage({ 'tagma.prompts.47': '[{"text":"дай задание","at":1}]' }) });

  expect(slot?.history.previous('')).toBe('дай задание');
});

test('a discarded first thread returns its words to the project draft and frees its old address', async () => {
  const discardedId = 'discarded-first-thread';
  door.create.mockResolvedValue({ snapshot: { thread: { id: discardedId } } });
  door.upload.mockRejectedValue(new Error('The image could not be uploaded.'));
  door.remove.mockResolvedValue({ status: 'deleted' });

  const host = open();
  const file = new File(['broken'], 'broken.png', { type: 'image/png' });
  const unsent = {
    text: 'Keep these words',
    images: [
      {
        id: 'image-1',
        filename: file.name,
        mediaType: 'image/png' as const,
        dataUrl: 'data:image/png;base64,YnJva2Vu',
        file,
        size: file.size,
      },
    ],
    files: [],
    mentions: [],
    pieces: [],
    documents: [],
  };
  host.draft.restore(unsent);

  expect(await host.chat.run(host.chat.commands.sendDraft(unsent, { clearCurrent: true }), true)).toBe(false);
  expect(host.activeId).toBeNull();
  expect(host.draft.key).toBe('new:47');
  expect(host.draft.current).toEqual(unsent);
  expect(routeOf(host).pending).toEqual([discardedId, null]);
  commitRoute(host);
  expect(host.activeId).toBeNull();

  host.open(discardedId);
  commitRoute(host);
  expect(host.draft.current).toEqual({ text: '', images: [], files: [], mentions: [], pieces: [], documents: [] });
});

test('a draft states the mode its thread is born with, and cycling it moves the pick the birth carries', async () => {
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'thread-born' } } });
  const host = open({ settings: settingsSaying('review') });
  host.birth.types.modes = builtinModeRegistry().declared();
  host.startDraft();
  commitRoute(host);

  expect(host.chat.target.modes?.active).toBe('review');
  expect(modeCycle(host.writes).available).toBe(true);

  await host.writes.perform(modeCycle(host.writes).run());
  expect(host.chat.target.modes?.active).toBe('bypass');

  host.draft.setText('the first turn');
  await host.writes.send();
  expect(door.create).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining({ approvalMode: 'bypass' }) }),
    expect.anything(),
  );
});

test('/delegation lands on the draft the birth carries or on the open thread', async () => {
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'thread-born' } } });
  const setDelegation = vi.fn().mockResolvedValue({ threadId: 'thread-1', own: true, allowed: true, setAt: 'thread-1' });
  const host = open({
    settings: {
      reloadSources: stubMutation(),
      catalog: stubFamily({ data: { sections: [], rejections: [], entries: [{ id: 'agent.delegation', value: false }] } }),
    },
    threads: { setDelegation: stubMutation(setDelegation) },
  });
  const delegation = delegationCommand(host.views, host.writes);
  const pick = (id: string) => host.writes.perform(delegation.run({ gesture: 'send', optionId: id }));

  host.startDraft();
  commitRoute(host);
  expect(delegation).toMatchObject({ value: 'Off' });
  await pick('on');
  expect(delegation).toMatchObject({ value: 'On' });
  host.draft.setText('the first turn');
  await host.writes.send();
  expect(door.create).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining({ delegation: true }) }),
    expect.anything(),
  );

  await shows('thread-1', opened({ delegation: { own: null, allowed: true, setAt: null } } as never));
  await pick('on');
  await waitFor(() => expect(delegation).toMatchObject({ value: 'On' }));
  expect(setDelegation).toHaveBeenCalledWith({ id: 'thread-1', projectId: 47, delegation: true }, expect.anything());

  port.emit(feedSnapshot(opened({ delegation: { own: null, allowed: false, setAt: 'thread-0' } } as never)), 'thread-1');
  await waitFor(() => expect(delegation).toMatchObject({ value: 'Off' }));
  expect(delegation.options?.find((option) => option.active)?.id).toBe('inherit');
});

test('/recap writes the open thread’s recap, waits without holding the composer, leaves a refusal to the feed and names a failure by its reason', async () => {
  const written = Promise.withResolvers<{ status: 'written' }>();
  const generateRecap = vi.fn().mockReturnValueOnce(written.promise);
  const host = open({ threads: { generateRecap: stubMutation(generateRecap) } });
  const recap = recapCommand(host.shown, host.chat, host.writes);
  const write = () => host.writes.perform(recap.run({ gesture: 'send' }));

  host.startDraft();
  commitRoute(host);
  expect(recap.disabled).toBe(true);

  await shows('thread-1');
  host.chat.target.fold.beginUserMessage({ text: 'what happened here?', turnKey: 'turn-1' });
  host.draft.setText('the next turn');
  expect(recap.disabled).toBe(false);

  const writing = write();
  await waitFor(() => expect(generateRecap).toHaveBeenCalledWith({ id: 'thread-1', projectId: 47 }, expect.anything()));
  expect(recap.disabled).toBe(true);
  expect(host.canSend).toBe(true);

  generateRecap.mockRejectedValueOnce(
    new Refusal({
      gate: true,
      code: 'recap-index-behind',
      reason: 'The conversation index does not cover the thread history completely.',
      unblock: ['Send a message and ask again.'],
    }),
  );
  written.resolve({ status: 'written' });
  await writing;
  expect(recap.disabled).toBe(false);
  expect(host.chat.commands.notice).toBeNull();

  await write();
  expect(recap.disabled).toBe(false);
  expect(host.chat.commands.notice).toBeNull();

  generateRecap.mockRejectedValueOnce(
    new Refusal({ gate: false, code: 'transport', reason: 'The server did not answer.', unblock: ['Ask again once it is back.'] }),
  );
  await write();
  expect(host.chat.commands.notice).toEqual({ tone: 'error', message: 'The server did not answer. Ask again once it is back.' });
});

test('a write in flight holds the thread it was started in, leaves every other thread free, and a thread left behind keeps no hold', async () => {
  const written = Promise.withResolvers<{ status: 'written' }>();
  const host = open({ threads: { generateRecap: stubMutation(() => written.promise) } });
  await shows('thread-1');
  void host.writes.perform(recapCommand(host.shown, host.chat, host.writes).run({ gesture: 'send' }));
  await waitUntil(() => host.writes.holding);

  await shows('thread-2');
  host.chat.target.fold.beginUserMessage({ text: 'what happened here?', turnKey: 'turn-1' });
  expect(host.writes.holding).toBe(false);
  expect(recapCommand(host.shown, host.chat, host.writes).disabled).toBe(false);

  host.open('thread-1');
  commitRoute(host);
  expect(host.writes.holding).toBe(false);

  written.resolve({ status: 'written' });
  await Promise.resolve();
  expect(host.writes.holding).toBe(false);
});

test('a setting chosen right before Enter reaches the turn: the send leaves once that write answered', async () => {
  const asked = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  const order: string[] = [];
  port.stub('send', () =>
    Effect.sync(() => {
      order.push('send');
      return { status: 'started', runId: 'run-1', acted: true };
    }),
  );
  const host = open({
    live: testLive({
      model: () =>
        Effect.promise(async () => {
          asked.resolve();
          await answer.promise;
          order.push('model');
        }),
    }),
    threads: { setDefaults: stubMutation(async (selection: unknown) => selection) },
  });
  await shows('thread-1');

  void host.writes.applySwitch('speed', 'fast');
  host.draft.setText('the next turn');
  const sent = host.writes.send();
  await asked.promise;
  answer.resolve();
  expect(await sent).toBe(true);
  expect(order).toEqual(['model', 'send']);
  expect(port.called('send').map((call) => call.threadId)).toEqual(['thread-1']);
});

test('a defaults save hanging after the thread’s own write answered does not hold Enter', async () => {
  const saving = Promise.withResolvers<void>();
  const host = open({
    live: testLive({ model: () => Effect.void }),
    threads: {
      setDefaults: stubMutation(() => {
        saving.resolve();
        return new Promise(() => {});
      }),
    },
  });
  await shows('thread-1');

  void host.writes.applySwitch('speed', 'fast');
  await saving.promise;
  host.draft.setText('the next turn');
  expect(await host.writes.send()).toBe(true);
  expect(port.called('send').map((call) => call.threadId)).toEqual(['thread-1']);
});

test('a write hanging on another thread does not hold Enter', async () => {
  const asked = Promise.withResolvers<void>();
  const live = testLive({
    model: () =>
      Effect.andThen(
        Effect.sync(() => asked.resolve()),
        Effect.never,
      ),
  });
  life = Scope.make();
  const [column, pane] = testThreadSlots(
    { projectId: 47, chat: testThreadChat(port), live, threads: { setDefaults: stubMutation(async (selection: unknown) => selection) } },
    [{}, { draft: 'new:47:side' }],
    life,
  );
  if (!column || !pane) throw new Error('two slots were not made');
  for (const [host, id] of [
    [column, 'thread-1'],
    [pane, 'thread-2'],
  ] as const) {
    host.open(id);
    commitRoute(host);
    port.emit(feedSnapshot(opened({ id }), null), id);
    await waitUntil(() => host.chat.session?.thread?.id === id);
  }
  void column.writes.applySwitch('speed', 'fast');
  await asked.promise;

  pane.draft.setText('the next turn');
  expect(await pane.writes.send()).toBe(true);
  expect(port.called('send').map((call) => call.threadId)).toEqual(['thread-2']);
});

test('a draft whose project settings are unread states no mode at all', () => {
  const host = open();
  host.startDraft();
  commitRoute(host);

  expect(host.chat.target.modes).toBeNull();
  expect(modeCycle(host.writes).available).toBe(false);
});

test('what the composer was carrying comes back after the page is reloaded', async () => {
  const storage = makeStorage();
  let host = open({ shelf: testShelf(storage), settings: settingsSaying('trust') });
  host.birth.types.modes = builtinModeRegistry().declared();
  host.activateRoute(null, 47);
  host.draft.setText('the prompt nobody sent yet');
  host.birth.applyType('rules');
  await host.writes.perform(modeCycle(host.writes).run());

  await life?.close();
  host = open({ shelf: testShelf(storage), settings: settingsSaying('trust') });
  host.birth.types.modes = builtinModeRegistry().declared();
  host.activateRoute(null, 47);
  expect(host.draft.text).toBe('the prompt nobody sent yet');
  expect(host.birth.draftType).toBe('rules');
  expect(host.chat.target.modes?.active).toBe('review');
});

test('a new thread as another agent leaves the open thread for a draft that is born as it', async () => {
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'thread-2' } } });
  const host = open();
  host.open('thread-1');
  commitRoute(host);
  expect(host.activeId).toBe('thread-1');
  host.birth.applyType('rules');
  expect(host.birth.draftType).toBeNull();

  host.startDraftAs('rules');
  commitRoute(host);
  expect(host.activeId).toBeNull();
  expect(host.birth.draftType).toBe('rules');

  host.draft.setText('hello');
  await host.writes.send();
  expect(door.create).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining({ type: 'rules' }) }),
    expect.anything(),
  );
});

it.live('/agent picks the draft type among agents alone, and on a born thread offers the others as a new thread', () =>
  Effect.gen(function* () {
    const page: ThreadTypesPage = {
      types: [
        { id: 'tagma', name: 'Tagma', description: 'The Tagma agent', baseAgentId: 'tagma' },
        { id: 'rules', name: 'Rules', description: 'Measures the rules', baseAgentId: 'rules' },
        {
          id: 'harness:claude-code',
          name: 'Claude Code',
          description: 'Claude Code as a thread',
          baseAgentId: 'harness',
          harness: {
            harness: 'claude-code',
            presentation: {
              label: 'Claude Code',
              iconProvider: 'claude-code',
              mark: null,
              install: null,
              modelProvider: 'claude-code',
              terminal: true,
              acp: true,
              hosted: true,
              sharedSessions: true,
            },
            binary: '/usr/local/bin/claude',
            version: '2.1.288',
            unreadable: null,
            serves: null,
            searching: false,
            missing: null,
          },
        },
      ],
      rejected: [],
      default: 'tagma',
      modes: [],
    };
    door.types.mockResolvedValue(page);
    const host = open();
    host.draft.setType('harness:claude-code');
    yield* Effect.promise(() => host.birth.types.read());
    expect(host.birth.draftType).toBeNull();

    const agent = agentCommand(host.shown, host.birth, host.writes);
    expect(agent.value).toBe('Tagma');
    expect(agent.options?.map((option) => [option.id, option.active ?? false, option.disabled ?? false])).toEqual([
      ['tagma', true, false],
      ['rules', false, false],
    ]);
    yield* agent.run({ gesture: 'send', optionId: 'rules' });
    expect(host.birth.draftType).toBe('rules');
    expect(agent.value).toBe('Rules');

    yield* Effect.promise(() => shows('thread-1', opened({ agentId: 'tagma', profile: null } as never)));
    expect(agent.options?.find((option) => option.id === 'tagma')).toMatchObject({ active: true, disabled: true });
    yield* agent.run({ gesture: 'send', optionId: 'rules' });
    commitRoute(host);
    expect(host.activeId).toBeNull();
    expect(host.birth.draftType).toBe('rules');
  }),
);

it.live(
  '/compact stands offered under a going run and opens its panel, whose steer gesture asks for the next step and queue gesture for the end',
  () =>
    Effect.gen(function* () {
      const compact = vi.fn((ask: { at?: 'step' | 'end' }) =>
        Effect.succeed({ status: 'requested' as const, requestId: `compact-${ask.at}`, at: ask.at ?? 'end', runId: 'run-1' }),
      );
      port.stub('compact', compact);
      const host = open();
      host.open('thread-1');
      commitRoute(host);
      port.emit(feedSnapshot(opened(), 'run-1'), 'thread-1');
      yield* Effect.promise(() => waitFor(() => expect(host.chat.commands.runId).toBe('run-1')));

      const command = compactCommand(host.shown, host.chat, host.writes, host.panel);
      expect(command.disabled).toBe(false);
      yield* command.run({ gesture: 'send', query: 'flash' });
      expect(host.panel.current).toMatchObject({ mode: 'compact', query: 'flash' });
      host.writes.compactWith('openai-oauth', 'test', null, 'send');
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(compact).toHaveBeenCalledTimes(1);
          expect(host.chat.commands.busy).toBeNull();
        }),
      );
      host.writes.compactWith('openai-oauth', 'test', null, 'queue');
      yield* Effect.promise(() => waitFor(() => expect(compact).toHaveBeenCalledTimes(2)));

      expect(compact.mock.calls).toEqual([[{ at: 'step' }], [{ at: 'end' }]]);
      expect(host.chat.commands.runId).toBe('run-1');
    }),
);

const choice = (provider: string, model: string, over: Partial<CompactionChoice> = {}): CompactionChoice => ({
  provider,
  model,
  label: model,
  providerLabel: provider,
  reasoning: 'high',
  spendable: true,
  skip: null,
  pays: { provider, account: null },
  own: false,
  folds: 'core',
  estimate: { inputTokens: 712_000, passes: 1 },
  ...over,
});

test('a compaction pick names no summarizer for the standing default, names any other row on its rung, drops a row the read lost, and no-summarizer answers with the ways out', async () => {
  const own = choice('subscription', 'opus', { own: true });
  const flash = choice('opencode-go', 'deepseek-v4.1-flash');
  const read: CompactionChoicesRead = {
    threadId: 'thread-1',
    rule: 'when-cold',
    warmth: { state: 'cold', invalidatedBy: 'account' },
    resolved: { kind: 'chain', reason: 'cold', choice: flash, skipped: [] },
    own,
    chain: [flash],
    others: { rows: [], shown: 0, total: 0, next: null },
  };
  const runs = ['run-2', 'run-3', 'run-4'];
  const compact = vi.fn((_ask: object) => {
    const runId = runs.shift();
    return runId === undefined
      ? Effect.fail(new ChatCommandRefused({ message: 'nothing spendable', code: 'no-summarizer' }))
      : Effect.succeed({ status: 'started' as const, runId, acted: true });
  });
  port.stub('compact', compact);
  const host = open({ threads: { compactionChoices: stubMutation(async () => read) } });
  await shows('thread-1');
  host.draft.setText('/');
  host.thread?.get(ThreadCompaction).watch(host.draft.slashOpen);
  await waitFor(() => expect(host.thread?.get(ThreadCompaction).choices).toEqual(read));

  host.writes.compactWith('opencode-go', 'deepseek-v4.1-flash', 'high', 'send');
  await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  await waitUntil(() => host.chat.commands.busy === null);
  host.writes.compactWith('subscription', 'opus', 'high', 'queue');
  await waitFor(() => expect(compact).toHaveBeenCalledTimes(2));
  await waitUntil(() => host.chat.commands.busy === null);
  host.writes.compactWith('opencode-go', 'deepseek-v4.1-flash', 'max', 'send');
  await waitFor(() => expect(compact).toHaveBeenCalledTimes(3));
  await waitUntil(() => host.chat.commands.busy === null);
  host.writes.compactWith('openai-oauth', 'gone', 'high', 'send');
  expect(compact.mock.calls).toEqual([
    [{ at: 'step' }],
    [{ at: 'end', summarizer: { provider: 'subscription', model: 'opus', reasoning: 'high' } }],
    [{ at: 'step', summarizer: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoning: 'max' } }],
  ]);

  host.writes.compactWith('opencode-go', 'deepseek-v4.1-flash', 'high', 'send');
  await waitFor(() => expect(host.thread?.get(ThreadCompaction).refusal).toBe('nothing spendable'));
  expect(host.chat.commands.notice).toBeNull();
});

const harnessPage: ThreadTypesPage = {
  types: [
    { id: 'tagma', name: 'Tagma', description: 'The Tagma agent', baseAgentId: 'tagma' },
    {
      id: 'harness:devin',
      name: 'Devin',
      description: 'Devin, run as a thread of Tagma',
      baseAgentId: 'harness',
      harness: {
        harness: 'devin',
        presentation: {
          label: 'Devin',
          iconProvider: null,
          mark: null,
          install: null,
          modelProvider: null,
          terminal: true,
          acp: true,
          hosted: false,
          sharedSessions: true,
        },
        binary: '/usr/local/bin/devin',
        version: 'devin 1.9.2',
        unreadable: null,
        serves: null,
        searching: false,
        missing: null,
      },
    },
  ],
  rejected: [],
  default: 'tagma',
  modes: [],
};

test('the menu starts a harness bare and opens its thread', async () => {
  door.types.mockResolvedValue(harnessPage);
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'devin-thread' } } });
  const host = open();
  await host.birth.types.read();

  await host.birth.launch('harness:devin');
  commitRoute(host);
  expect(door.create).toHaveBeenCalledWith({ projectId: 47, payload: { type: 'harness:devin', task: '' } }, expect.anything());
  expect(port.called('send')).toEqual([]);
  expect(host.activeId).toBe('devin-thread');
});

test('a refused menu birth belongs to creation and leaves the open thread and its notice alone', async () => {
  const refused = new Refusal({
    gate: true,
    code: 'provider-not-installed',
    reason: 'No installed adapter provides "external".',
    unblock: ['Install an adapter for the provider.'],
  });
  door.create.mockRejectedValueOnce(refused).mockResolvedValueOnce({ snapshot: { thread: { id: 'cursor-thread' } } });
  const host = open();
  await shows('thread-1');
  const notice = { tone: 'error' as const, message: 'The previous turn was refused.' };
  host.chat.commands.say(notice);

  expect(await host.birth.launch('harness:cursor')).toBeNull();
  expect(host.activeId).toBe('thread-1');
  expect(host.chat.commands.notice).toEqual(notice);
  expect(host.birth.refusal).toEqual({ text: refused.reason, code: refused.code, details: refused.unblock });

  const retry = host.birth.launch('harness:cursor');
  expect(host.birth.refusal).toBeNull();
  expect(await retry).toBe('cursor-thread');
  commitRoute(host);
  expect(host.activeId).toBe('cursor-thread');
});

const listRow = (id: string, agentId: string, profileId: string | null, title: string): ThreadListRow =>
  ({ id, agentId, profileId, title, parentThreadId: null, harness: null }) as unknown as ThreadListRow;

test('the open thread is named off its list row for a CLI thread and off its snapshot for a chat', async () => {
  const list = $state({
    threads: [
      listRow('claude-thread', 'harness', 'harness:claude-code', 'Claude session'),
      listRow('devin-thread', 'harness', 'harness:devin', 'Devin session'),
      listRow('chat-thread', 'tagma', null, 'A chat'),
    ],
    births: { settle: () => undefined, draw: (_id: string, base: unknown) => base },
    row(id: string) {
      return this.threads.find((held: ThreadListRow) => held.id === id);
    },
  });
  const host = open({
    list,
    accounts: {
      rows: [],
      known: true,
      providers: [],
      of: () => [{ account: 'o1', label: 'codex@runlith.dev', default: true }],
      signing: () => [{ account: 'o1', label: 'codex@runlith.dev', default: true }],
    },
  });
  await waitUntil(() => host.views.model.settings !== null);

  host.open('claude-thread');
  commitRoute(host);
  expect(host.identity).toEqual({ id: 'claude-thread', title: 'Claude session', parentThreadId: null, bornAs: 'harness:claude-code' });
  expect(host.views.model.accountLabel).toBeNull();

  host.open('devin-thread');
  commitRoute(host);
  expect(host.identity).toEqual({ id: 'devin-thread', title: 'Devin session', parentThreadId: null, bornAs: 'harness:devin' });
  list.threads[1] = listRow('devin-thread', 'harness', 'harness:devin', 'Renamed in another window');
  expect(host.identity?.title).toBe('Renamed in another window');

  host.open('chat-thread');
  commitRoute(host);
  port.emit(feedSnapshot(opened({ id: 'chat-thread', title: 'A chat', agentId: 'tagma', profile: null } as never)), 'chat-thread');
  await waitFor(() => expect(host.identity).toEqual({ id: 'chat-thread', title: 'A chat', parentThreadId: null, bornAs: 'tagma' }));
  expect(host.views.model.accountLabel).toBe('codex@runlith.dev');

  host.open('claude-thread');
  commitRoute(host);
  expect(host.identity?.id).toBe('claude-thread');
});

test('a refresh answered after the slot moved to another thread is not published into its view', async () => {
  const refreshed: ThreadInstructionsRefreshed = {
    status: 'updated',
    sources: { skills: [], contextFiles: [], rejected: [] },
    instructions: { delivered: null, current: { audience: 'graph', entries: 0 }, pending: [], withdrawn: [] },
  };
  const late = Promise.withResolvers<ThreadInstructionsRefreshed>();
  door.refresh.mockReturnValueOnce(late.promise).mockResolvedValueOnce(refreshed);
  const host = open();
  host.open('thread-a');
  commitRoute(host);
  const refresh = refreshInstructionsCommand(host.shown, host.writes);

  const first = host.writes.perform(refresh.run({ gesture: 'send' }));
  await waitFor(() => expect(door.refresh).toHaveBeenCalledWith({ id: 'thread-a', projectId: 47 }, expect.anything()));
  host.open('thread-b');
  commitRoute(host);
  late.resolve(refreshed);
  await first;
  expect(host.chat.commands.notice).toBeNull();

  await host.writes.perform(refresh.run({ gesture: 'send' }));
  expect(host.chat.commands.notice).not.toBeNull();
});

test('a birth that finishes after the slot moved on leaves the new thread in the list and the slot where it is', async () => {
  const born = Promise.withResolvers<{ snapshot: { thread: { id: string } } }>();
  door.create.mockReturnValue(born.promise);
  const host = open();
  host.startDraft();
  commitRoute(host);
  host.draft.setText('first words');
  const sending = host.writes.send();
  await waitFor(() => expect(door.create).toHaveBeenCalled());

  host.open('thread-elsewhere');
  commitRoute(host);
  born.resolve({ snapshot: { thread: { id: 'thread-born' } } });
  await sending;

  expect(host.activeId).toBe('thread-elsewhere');
  expect(port.called('send').map((call) => call.threadId)).toEqual(['thread-born']);
});

test('a birth shows its new thread at once and sends the first words there', async () => {
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'thread-born' } } });
  const host = open();
  host.startDraft();
  commitRoute(host);
  host.draft.setText('first words');

  expect(await host.writes.send()).toBe(true);
  commitRoute(host);

  expect(host.activeId).toBe('thread-born');
  expect(port.called('send').map((call) => call.threadId)).toEqual(['thread-born']);
});

test('a column and a pane showing one thread hold one scope, one subscription and one draft, and the thread outlives the pane that leaves it', async () => {
  life = Scope.make();
  const [column, pane] = testThreadSlots({ projectId: 47, chat: testThreadChat(port) }, [{}, {}], life);
  if (!column || !pane) throw new Error('two slots were not made');
  column.open('thread-1');
  commitRoute(column);
  pane.open('thread-1');
  commitRoute(pane);
  port.emit(feedSnapshot(opened(), null), 'thread-1');
  await waitUntil(() => column.chat.session?.thread?.id === 'thread-1');

  expect(pane.chat.session).toBe(column.chat.session);
  expect(port.feeds).toHaveLength(1);
  expect(pane.draft.key).toBe(column.draft.key);
  column.draft.setText('shared words');
  expect(pane.draft.text).toBe('shared words');

  pane.open('thread-2');
  commitRoute(pane);
  expect(port.feeds[0]?.open).toBe(true);
  expect(column.chat.session?.thread?.id).toBe('thread-1');

  column.open('thread-3');
  commitRoute(column);
  await waitUntil(() => port.feeds[0]?.open === false);
});

test('a first turn the server refuses keeps the born thread and gives the words back', async () => {
  door.create.mockResolvedValue({ snapshot: { thread: { id: 'thread-born' } } });
  port.refuses('send', 'The agent is busy elsewhere.');
  const host = open();
  host.startDraft();
  commitRoute(host);
  host.draft.setText('first words');

  expect(await host.writes.send()).toBe(false);
  commitRoute(host);

  expect(door.remove).not.toHaveBeenCalled();
  expect(host.activeId).toBe('thread-born');
  expect(host.draft.text).toBe('first words');
});

it.live('a birth that finishes after the slot closed still answers the thread it created', () =>
  Effect.gen(function* () {
    const born = Promise.withResolvers<{ snapshot: { thread: { id: string } } }>();
    door.create.mockReturnValue(born.promise);
    const host = open();
    host.startDraft();
    commitRoute(host);
    host.draft.setText('first words');
    const bearing = yield* Effect.forkScoped(host.birth.born());
    yield* Effect.promise(() => waitFor(() => expect(door.create).toHaveBeenCalled()));

    yield* Effect.promise(async () => {
      await life?.close();
    });
    born.resolve({ snapshot: { thread: { id: 'thread-born' } } });

    expect(yield* Fiber.join(bearing)).toMatchObject({ threadId: 'thread-born' });
  }),
);

test('a late birth never takes the words of the draft a later opening stands on', async () => {
  const born = Promise.withResolvers<{ snapshot: { thread: { id: string } } }>();
  door.create.mockReturnValue(born.promise);
  const host = open();
  host.startDraft();
  commitRoute(host);
  host.draft.setText('first words');
  const sending = host.writes.send();
  await waitFor(() => expect(door.create).toHaveBeenCalled());

  host.open('thread-elsewhere');
  commitRoute(host);
  host.startDraft();
  commitRoute(host);
  host.draft.setText('second words');
  born.resolve({ snapshot: { thread: { id: 'thread-born' } } });
  await sending;

  expect(host.draft.text).toBe('second words');
});

test('two fresh slots of one project stand on their own drafts', async () => {
  life = Scope.make();
  const [column, pane] = testThreadSlots({ projectId: 47, chat: testThreadChat(port) }, [{}, { draft: 'new:47:side' }], life);
  if (!column || !pane) throw new Error('two slots were not made');
  expect(column.draft.key).toBe('new:47');
  expect(pane.draft.key).toBe('new:47:side');
});
