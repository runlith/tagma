// @vitest-environment jsdom

import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import type { ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import { Scope } from '@runlith/layer/Scope';
import { Effect } from 'effect';
import { afterEach, expect, test, vi } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';
import { feedSnapshot, testLive, testThreadChat, testThreadSlot, commitRoute } from '$lib/app/slotWorld.js';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
const DECLARED_MODES = builtinModeRegistry().declared();
import { approvalModes as declaredModes } from '../modeWords.js';
import { commands as modeDeclarations, modeCycle } from '../native/commands/mode.commands.js';
import { declaredCommand } from '../native/testing.js';
import type { ThreadSlot } from '../ThreadSlot.svelte.js';

let life: Scope | null = null;
let port = new TestConnection<WireThread>();

afterEach(async () => {
  await life?.close();
  life = null;
  port = new TestConnection<WireThread>();
});

const authority = (mode: string) => ({ mode, bypassFrom: mode === 'bypass' ? 'thread-1' : null });

const thread = (mode: string, over: object = {}): WireThread =>
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
    authority: authority(mode),
    modes: DECLARED_MODES,
    delegation: { own: null, allowed: true, setAt: null },
    capabilities: NATIVE_CAPABILITIES,
    ...over,
  }) as unknown as WireThread;

const PLAN = { id: 'plan', label: 'Plan', description: 'Proposes before it acts.', icon: 'eye', strictness: 3 };

const approvalModes = (active: string): ThreadModes => declaredModes(DECLARED_MODES, active);

const fourModes = (active: string): ThreadModes => declaredModes([...DECLARED_MODES, PLAN], active);

function open(write: (params: unknown) => Effect.Effect<unknown, never>): ThreadSlot {
  life = Scope.make();
  return testThreadSlot({ projectId: 47, chat: testThreadChat(port), live: testLive({ authority: write }) }, {}, life);
}

async function shows(slot: ThreadSlot, shown: WireThread, modes: ThreadModes): Promise<void> {
  slot.open(shown.id);
  commitRoute(slot);
  port.emit(feedSnapshot(shown, null, modes), shown.id);
  await waitFor(() => expect(slot.chat.target.modes?.active).toBe(modes.active));
}

test('a draft offers the modes its birth catalog served and accepts a registered mode', async () => {
  const slot = open(() => Effect.succeed({}));
  slot.birth.types.modes = [...DECLARED_MODES, PLAN];
  slot.draft.setApprovalMode('trust');
  expect(slot.birth.authority.modes?.declared.map((mode) => mode.id)).toEqual(['trust', 'review', 'bypass', 'plan']);
  await slot.writes.perform(slot.writes.chooseMode('plan'));
  expect(slot.draft.approvalMode).toBe('plan');
  expect(slot.birth.authority.modes?.active).toBe('plan');
});

test('the modes of the open thread are the ones its producer declared, and cycling reaches each of them', async () => {
  const written: unknown[] = [];
  const slot = open((params) => {
    written.push(params);
    return Effect.succeed({ snapshot: { thread: thread((params as { mode: string }).mode) } });
  });
  await shows(slot, thread('bypass'), fourModes('bypass'));

  const mode = declaredCommand(modeDeclarations, 'mode', slot);
  expect(mode.options?.map((option) => option.id)).toEqual(['trust', 'review', 'bypass', 'plan']);
  expect(mode).toMatchObject({ value: 'Bypass', valueActive: true });

  await slot.writes.perform(modeCycle(slot.writes).run());
  expect(written).toEqual([{ mode: 'plan' }]);

  await slot.writes.perform(slot.writes.chooseMode('review'));
  expect(written).toEqual([{ mode: 'plan' }, { mode: 'review' }]);
  expect(slot.chat.target.modes?.active).toBe('review');
});

test('a mode chosen while a send is in flight and while an earlier mode write is unanswered lands, every click in order', async () => {
  const written: string[] = [];
  const answered = Promise.withResolvers<void>();
  const slot = open((params) => {
    const mode = (params as { mode: string }).mode;
    written.push(mode);
    return Effect.promise(() => answered.promise).pipe(Effect.as({ snapshot: { thread: thread(mode) } }));
  });
  await shows(slot, thread('trust'), approvalModes('trust'));
  const held = port.hold('send');
  slot.draft.setText('the next turn');
  const sending = slot.writes.send();
  await held;

  const first = slot.writes.perform(modeCycle(slot.writes).run());
  await waitFor(() => expect(slot.writes.modes?.active).toBe('review'));
  const second = slot.writes.perform(modeCycle(slot.writes).run());
  await waitFor(() => expect(slot.writes.modes?.active).toBe('bypass'));

  answered.resolve();
  await Promise.all([first, second]);
  expect(written).toEqual(['review', 'bypass']);
  expect(slot.chat.target.modes?.active).toBe('bypass');
  port.release('send');
  expect(await sending).toBe(true);
});

test('a mode the thread does not declare is refused before any write', async () => {
  const write = vi.fn(() => Effect.succeed({}));
  const slot = open(write);
  await shows(slot, thread('trust'), approvalModes('trust'));

  await slot.writes.perform(slot.writes.chooseMode('plan'));
  expect(write).not.toHaveBeenCalled();
  expect(slot.chat.commands.notice).toEqual({ tone: 'error', message: 'This thread declares no mode "plan".' });
});

const cli = (mode: string, transport: 'terminal' | 'acp' = 'terminal') =>
  thread(mode, {
    agentId: 'harness',
    capabilities: { ...NATIVE_CAPABILITIES, screen: transport === 'terminal' },
    harness: {
      name: 'claude-code',
      transport,
      execution: { execution: 'run', incarnation: 1 },
      process: { id: 'p-1', state: 'running', startedAt: '2026-10-09T10:00:00.000Z' },
    },
  });

test('a terminal thread opened by address takes the terminal surface and states its mode, and cycling writes it', async () => {
  const written: unknown[] = [];
  const slot = open((params) => {
    written.push(params);
    return Effect.succeed({ snapshot: { thread: cli((params as { mode: string }).mode) } });
  });
  slot.activateRoute('thread-1', 47);
  expect(slot.surface.terminal).toBeNull();

  port.emit(feedSnapshot(cli('review'), null, approvalModes('review')), 'thread-1');
  await waitFor(() => expect(slot.surface.terminal).toMatchObject({ threadId: 'thread-1', projectId: 47 }));
  expect(slot.chat.target.modes?.active).toBe('review');
  expect(modeCycle(slot.writes).available).toBe(true);

  await slot.writes.perform(modeCycle(slot.writes).run());
  expect(written).toEqual([{ mode: 'bypass' }]);
  expect(slot.chat.target.modes?.active).toBe('bypass');
});

test('a terminal thread whose transport moves to acp leaves the terminal surface', async () => {
  const slot = open(() => Effect.succeed({}));
  slot.activateRoute('thread-1', 47);
  port.emit(feedSnapshot(cli('review'), null, approvalModes('review')), 'thread-1');
  await waitUntil(() => slot.surface.terminal !== null);

  port.emit(feedSnapshot(cli('review', 'acp'), null, approvalModes('review')), 'thread-1');
  await waitUntil(() => slot.surface.terminal === null);
});

test('a refused write leaves the terminal thread’s mode and names why on the thread', async () => {
  const slot = open(() => Effect.fail(new Error('The thread is not yours to change.')) as never);
  slot.activateRoute('thread-1', 47);
  port.emit(feedSnapshot(cli('review'), null, approvalModes('review')), 'thread-1');
  await waitFor(() => expect(slot.chat.target.modes?.active).toBe('review'));

  await slot.writes.perform(modeCycle(slot.writes).run());
  expect(slot.chat.target.modes?.active).toBe('review');
  expect(slot.views.authority.terminalRefusal).toBe('The thread is not yours to change.');
});

test('a mode reply that arrives after the thread was left revises nothing', async () => {
  const gate = Promise.withResolvers<void>();
  const slot = open((params) =>
    Effect.promise(() => gate.promise).pipe(Effect.as({ snapshot: { thread: thread((params as { mode: string }).mode) } })),
  );
  await shows(slot, thread('bypass'), fourModes('bypass'));
  const session = slot.chat.session;
  if (session === null) throw new Error('the thread was not shown');

  const writing = slot.writes.perform(slot.writes.chooseMode('review'));
  await waitFor(() => expect(slot.writes.modes?.active).toBe('review'));
  slot.open('thread-2');
  commitRoute(slot);
  gate.resolve();
  await writing;

  expect(session.modes?.active).toBe('bypass');
});
