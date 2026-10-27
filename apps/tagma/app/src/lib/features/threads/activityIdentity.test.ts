import type { ChatEntry } from '@runlith/chat-ui/entries';
import { expect, test } from 'vitest';
import { activityIdentity, awaitedTarget } from './activityIdentity.js';

const call = (toolName: string, toolInput: unknown): ChatEntry =>
  ({ id: 'e1', kind: 'tool', toolName, toolCallId: 'call-1', toolState: 'input-available', toolInput }) as ChatEntry;

const awaited = (toolName: string, toolInput: unknown, awaitsMs: number): ChatEntry =>
  ({
    ...call(toolName, toolInput),
    display: {
      form: 'none',
      title: 'Waiting for a command',
      reference: { kind: 'command', execution: 'exec-1', incarnation: 52, standing: false },
      awaitsMs,
    },
  }) as ChatEntry;

test('a wait reads its target and budget from the declaration display, not the operation name or input', () => {
  const address = { execution: 'exec-1', incarnation: 52 };
  const target = { kind: 'execution', address };
  expect(awaitedTarget(awaited('any_wait', {}, 600_000))).toEqual({ target, budgetMs: 600_000 });
  expect(awaitedTarget(awaited('read_output', {}, 0))).toEqual({ target, budgetMs: null });
  expect(awaitedTarget(call('read_output', { ...address }))).toBeNull();
  expect(awaitedTarget(call('bash', { command: 'sleep 1' }))).toBeNull();

  const aimed = (reference: unknown): ChatEntry =>
    ({ ...call('wait_terminal', {}), display: { form: 'none', title: 'Waiting', awaitsMs: 30_000, reference } }) as ChatEntry;
  expect(awaitedTarget(aimed({ kind: 'terminal', ...address }))).toEqual({ target, budgetMs: 30_000 });
  expect(awaitedTarget(aimed({ kind: 'call', runId: 'run-1', toolCallId: 'call-9' }))).toEqual({
    target: { kind: 'call', address: { runId: 'run-1', toolCallId: 'call-9' } },
    budgetMs: 30_000,
  });
});

test('a call aimed at an agent is named by the addressee its display declares, and links the thread it reached', () => {
  const thread = '01a0eab2-ce92-7634-aa1e-dd7512346cbd';
  const label = (address: string) => (address === thread ? 'Reviewer thread' : address);
  const entry = {
    ...call('any_verb', {}),
    display: {
      form: 'text',
      text: '',
      title: 'critic',
      subtitle: 'Read this',
      reference: { kind: 'agent', address: 'critic', id: thread, projectId: 7 },
    },
  } as ChatEntry;

  expect(
    activityIdentity(
      entry,
      label,
      () => null,
      () => null,
    ),
  ).toEqual({
    title: 'critic',
    threads: [{ id: thread, title: 'Reviewer thread', projectId: 7 }],
  });
});

test('a thread declared by a tool keeps its home without a directory row', () => {
  const threadId = '01a0eab2-ce92-7634-aa1e-dd7512346cbd';
  const entry = {
    ...call('spawn_agent', { project: 'requested-place' }),
    display: { form: 'text', text: '', reference: { kind: 'thread', id: threadId, projectId: 7 } },
  } as ChatEntry;
  expect(
    activityIdentity(
      entry,
      (id) => id,
      () => null,
      () => null,
    )?.threads,
  ).toEqual([{ id: threadId, title: threadId, projectId: 7 }]);
});

test('a thread a call names without declaring its home links the home the thread’s owner answers, whatever project the input names', () => {
  const threadId = '01a0eab2-ce92-7634-aa1e-dd7512346cbd';
  const entry = {
    ...call('read_thread', { threadId, project: 5 }),
    display: { form: 'none', title: threadId },
  } as ChatEntry;
  const threads = (home: number | undefined) =>
    activityIdentity(
      entry,
      (id) => id,
      () => null,
      () => null,
      () => home,
    )?.threads;
  expect(threads(7)).toEqual([{ id: threadId, title: threadId, projectId: 7 }]);
  expect(threads(undefined)).toEqual([]);
});

test('an address before resolution links only a known home, and a result’s declared home wins', () => {
  const known = '01a0eab2-ce92-7634-aa1e-dd7512346cbd';
  const unknown = '01a0eab2-ce92-7634-aa1e-dd7512346cbe';
  const projected = (reference: unknown) =>
    activityIdentity(
      { ...call('send_message', {}), display: { form: 'none', reference } } as ChatEntry,
      (id) => id,
      () => null,
      () => null,
      (id) => (id === known ? 7 : undefined),
    )?.threads;
  expect(projected({ kind: 'agent', address: known })).toEqual([{ id: known, title: known, projectId: 7 }]);
  expect(projected({ kind: 'agent', address: unknown })).toEqual([]);
  expect(projected({ kind: 'agent', address: known, id: known, projectId: 8 })).toEqual([{ id: known, title: known, projectId: 8 }]);
  expect(projected({ kind: 'agents', recipients: [{ address: known }, { address: unknown }, { address: 'critic' }] })).toEqual([
    { id: known, title: known, projectId: 7 },
  ]);
});

test('a send to several agents names its recipients in one row and links every thread it reached', () => {
  const reviewer = '01a0eab2-ce92-7634-aa1e-dd7512346cbd';
  const planner = '01a0eab2-ce92-7634-aa1e-dd7512346cbe';
  const label = (address: string) => (address === planner ? 'Planner thread' : address);
  const entry = {
    ...call('send_message', {}),
    display: {
      form: 'text',
      text: '',
      title: 'critic, planner',
      subtitle: 'Read this',
      reference: {
        kind: 'agents',
        recipients: [
          { address: 'critic', id: reviewer, projectId: 7 },
          { address: planner, id: planner, projectId: 8 },
        ],
      },
    },
  } as ChatEntry;

  expect(
    activityIdentity(
      entry,
      label,
      () => null,
      () => null,
    ),
  ).toEqual({
    title: 'critic, Planner thread',
    threads: [
      { id: reviewer, title: reviewer, projectId: 7 },
      { id: planner, title: 'Planner thread', projectId: 8 },
    ],
  });
});
