// @vitest-environment jsdom
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { Cache } from '@runlith/query/repo';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, liveFeed, screen, type TestApp } from '$lib/app/testing.js';
import { testProviders } from '$lib/features/providers/testing.js';
import { NOT_INSTALLED } from '$lib/features/providers/served.js';
import { makeStorage } from '@runlith/layer/testing';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
import { View } from '$lib/features/executions/load/View.svelte.js';
import { Scope } from '@runlith/layer/Scope';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { Door } from '$lib/wire/Door.js';
import { CallActivity } from './CallActivity.svelte.js';
import ThreadRow from './Row.svelte';
import { AgentTypes } from './AgentTypes.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { ThreadFolds } from './threadFolds.svelte.js';
import { WorkLines } from './workLines.svelte.js';
import type { Team, ThreadTreeNode } from './forest.js';

const entry = (over: Partial<ThreadListRow> = {}): ThreadListRow => ({
  id: 'thread-1',
  projectId: 1,
  scopeName: null,
  title: 'A held thread',
  titleOrigin: 'random',
  life: 'idle',
  activeRunId: null,
  activeRunStartedAt: null,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: null,
  outcome: null,
  spawnRootId: 'thread-1',
  parentThreadId: null,
  name: null,
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  account: null,
  provider: 'subscription',
  model: 'claude-opus-5',
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: '2026-01-01T00:00:00.000Z',
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

let app: TestApp | undefined;

afterEach(close);

function close(): void {
  if (app) void app.unmount();
  app = undefined;
}

const QUIET_TEAM: Team = { working: 0, asking: 0, failed: 0, cut: 0, unseen: 0, pinned: 0, size: 0, workers: [] };

function draw(
  row: ThreadListRow,
  children: readonly ThreadTreeNode[] = [],
  lastEventAt = row.readerOrderAt,
  parent: ThreadListRow | null = null,
  feed = liveFeed(),
  readings: Readings | null = null,
): HTMLElement {
  const node: ThreadTreeNode = { row, children, life: row.life, lifeBelow: 'idle', liveSince: null, lastEventAt, team: QUIET_TEAM };
  app = mountShell(
    Layer.mergeAll(
      WallClock,
      WorkLines,
      AgentTypes,
      ThreadsRepo,
      Cache.of(),
      testProviders(),
      Notices,
      ThreadNames,
      CommandActivity,
      CallActivity,
      screen(),
      View,
      ExecutionActs,
      ...(readings === null ? [Readings] : []),
    ),
    Layer.mergeAll(
      ...(readings === null ? [] : [Layer.of(Readings, readings)]),
      Layer.of(ExecutionsRepo, { inventory: stubFamily(), commands: stubFamily() } as never),
      Layer.of(Workspace, { contextProject: { rootPath: '/repo' }, find: () => ({ rootPath: '/repo' }) } as never),
      Layer.of(Live, feed.live),
      Layer.of(Door, { ask: () => Promise.reject(new Error('this suite makes no call')) } as never),
    ),
  );
  const host = app.draw(ThreadRow as never, {
    node,
    folds: new ThreadFolds({ projectId: 1 }, new ReaderMarks(makeStorage())),
    activeId: null,
    parent,
  });
  flushSync();
  return host;
}

const asked = (ask: ThreadListRow['ask']): ThreadListRow =>
  entry({
    agentId: 'harness',
    life: 'awaiting',
    ask,
    harness: {
      name: 'devin',
      provider: 'devin-oauth',
      transport: 'terminal',
      agent: null,
      capabilities: {
        messaging: true,
        judgedModel: false,
        history: 'none',
        compaction: 'none',
        modelMove: 'pinned',
        openings: 'core',
        pictures: true,
        web: 'none',
        law: null,
        touch: null,
        authorship: null,
        steer: 'none',
        withdraw: false,
        callEnvelopeMs: null,
        screen: false,
        continue: true,
        feed: 'turns',
        usage: 'none',
        aside: 'none',
      },
      model: null,
      effort: null,
      asked: null,
      execution: { execution: 'e-1', incarnation: 1 },
      process: { id: 's-1', state: 'running', startedAt: '2026-01-01T09:00:00.000Z' },
      observation: {
        binding: { sessionId: 's-1', execution: { execution: 'e-1', incarnation: 1 }, rootKey: 'root-1' },
        revision: 1,
        metadata: { model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: { _tag: 'NotRead' } },
        diagnostics: [],
      },
    },
  });

const standingAsk: NonNullable<ThreadListRow['ask']> = {
  questionId: 'question-1',
  text: 'Delete the build directory?',
  kind: 'question',
  key: 'screen:1',
  askedAt: '2026-01-01T10:00:00.000Z',
  options: [{ label: 'Yes, delete it', answers: [{ questionId: 'question-1', values: ['1'] }] }],
};

test('a row carries its address from the press or the focus that opens it, and drops it once the pointer leaves', () => {
  const row = draw(entry()).querySelector<HTMLAnchorElement>('a[data-thread]');
  if (row === null) throw new Error('The row drew no link.');
  expect(row.getAttribute('href')).toBeNull();

  row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(row.getAttribute('href')).toContain('/chat/thread-1');

  row.dispatchEvent(new Event('pointerleave'));
  flushSync();
  expect(row.getAttribute('href')).toBeNull();

  row.focus();
  expect(row.getAttribute('href')).toContain('/chat/thread-1');
});

test('a harness row waiting on a question shows what it was asked, and shows nothing without one', () => {
  const stopped = draw(asked(standingAsk)).textContent ?? '';
  expect(stopped).toContain('Delete the build directory?');

  const quiet = draw(asked(null)).textContent ?? '';
  expect(quiet).not.toContain('Delete the build directory?');
});

test('a thread holding uncommitted paths wears the count, a mark when some are unchecked, and one holding none wears nothing', () => {
  expect(draw(entry({ held: { paths: 0, unproven: 0 } })).querySelector('[data-thread-held]')).toBeNull();

  const clean = draw(entry({ held: { paths: 4, unproven: 0 } })).querySelector('[data-thread-held]');
  expect(clean?.textContent?.trim()).toBe('4');
  expect(clean?.querySelector('[data-changes-unchecked]')).toBeNull();

  const unchecked = draw(entry({ held: { paths: 29, unproven: 1 } })).querySelector('[data-thread-held]');
  expect(unchecked?.textContent?.trim()).toBe('29');
  expect(unchecked?.querySelector('[data-changes-unchecked]')).not.toBeNull();
});

test("a resting row's stamp is the tree's last event, never the row's last write", () => {
  const now = Date.now();
  const written = new Date(now - 2 * 60_000).toISOString();
  const event = new Date(now - 4 * 60 * 60_000).toISOString();

  const time = draw(entry({ updatedAt: written }), [], event).querySelector('[data-thread-time]');
  expect(time?.textContent?.trim()).toBe('4h');
});

test('a working row names its open call, and a working row with no call standing still draws its line', () => {
  const running = { life: 'working', activeRunId: 'run-1', activeRunStartedAt: new Date().toISOString() } as const;
  const calls = [
    { name: 'read', title: 'read ThreadRow.svelte', since: Date.now() },
    { name: 'bash', title: null, since: Date.now() },
  ];
  const line = draw(entry({ id: 'calling', ...running, phase: { phase: 'tools', since: null, calls, queued: 0 } })).querySelector(
    '[data-thread-line]',
  );
  expect(line?.textContent).toContain('read ThreadRow.svelte');

  const thinking = draw(entry({ id: 'thinking', ...running, phase: { phase: 'reasoning', since: Date.now(), calls: [], queued: 0 } }));
  expect(thinking.querySelector('[data-thread-line]')).not.toBeNull();
});

test('a child on its parent’s selection draws its plate faint, and one on another model at full ink', () => {
  const parent = entry({ id: 'parent', model: 'claude-opus-5', reasoning: 'xhigh' });
  const child = (over: Partial<ThreadListRow>) =>
    entry({ id: 'child', parentThreadId: 'parent', name: 'review', model: 'claude-opus-5', reasoning: 'xhigh', ...over });
  const faint = (target: HTMLElement) => target.querySelector('[data-plate-same]') !== null;

  expect(faint(draw(child({}), [], undefined, parent))).toBe(true);
  expect(faint(draw(child({ provider: 'openai-oauth', model: 'gpt-6-sol' }), [], undefined, parent))).toBe(false);
  expect(faint(draw(child({ reasoning: 'high' }), [], undefined, parent))).toBe(false);
});

test('a thread on a provider no installed adapter serves says so on its plate, and one on a served provider does not', () => {
  const plate = (row: ThreadListRow) => draw(row).querySelector('[data-plate]')?.getAttribute('aria-label') ?? '';

  expect(plate(entry({ provider: 'removed-adapter', model: 'its-model', reasoning: 'high' }))).toContain(NOT_INSTALLED);
  expect(plate(entry())).not.toContain(NOT_INSTALLED);
});

test("a thread wears the load badge while its agent row carries live work, with that work's count and machine share, its own harness session uncounted, and the badge opens exactly that work", () => {
  const feed = liveFeed();
  const readings = new Readings(feed.live, Scope.make());
  const host = draw(entry(), [], undefined, null, feed, readings);
  readings.hold();
  const machine = feed.routes.get('load.machine');
  if (machine === undefined) throw new Error('The machine feed was not subscribed.');
  const execution = { installation: 'inst', execution: 'mine', incarnation: 0 };
  const row = (thread: string, share: number, executions: number, sessions = 0) => ({
    key: `agent:${thread}`,
    kind: 'agent',
    title: thread,
    thread,
    share,
    rank: share,
    memoryBytes: 1024,
    unread: 0,
    minor: false,
    processes: [],
    work: {
      executions: [
        ...Array.from({ length: executions }, (_, at) => ({
          projectId: 1,
          key: `mine:${at}`,
          kind: 'command',
          transport: 'pipes',
          execution,
          session: false,
          label: `bun test ${at}`,
          share: 0.05,
          memoryBytes: 1024,
        })),
        ...Array.from({ length: sessions }, () => ({
          projectId: 1,
          key: 'session:0',
          kind: 'terminal',
          transport: 'pty',
          execution,
          session: true,
          label: 'claude',
          share: 0.05,
          memoryBytes: 1024,
        })),
      ],
      residuals: [],
    },
  });
  const none = { count: 0, share: 0, memoryBytes: 0, unread: 0 };
  const view = (rows: readonly unknown[]) => ({
    scope: { host: { _tag: 'Local', machine: 'm' }, network: { _tag: 'Local', machine: 'm' } },
    readAt: 1,
    cores: 12,
    share: 0.5,
    memory: { _tag: 'Unknown', reason: 'unknown', detail: '' },
    saturated: false,
    rows,
    totals: { own: none, agent: none, work: none, outside: none, others: none },
  });
  const badge = (): string | null => host.querySelector('[data-thread-load]')?.textContent?.replace(/\s+/g, '') ?? null;

  machine({
    _tag: 'Snapshot',
    sequence: 0,
    snapshot: {
      composedAt: 1,
      reader: 'reader-1',
      state: { _tag: 'Read', view: view([row('thread-1', 0.125, 1, 1), row('thread-2', 0.25, 2)]) },
      history: [],
    },
  });
  flushSync();
  expect(badge()).toBe('1·13%');

  host.querySelector<HTMLElement>('[data-thread-load]')?.click();
  flushSync();
  const lines = [...document.querySelectorAll('[data-work-peek="thread-1"] [data-work-line]')].map((line) => line.textContent ?? '');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('bun test 0');

  machine({
    _tag: 'Delta',
    sequence: 1,
    base: 0,
    delta: { composedAt: 2, state: { _tag: 'Read', view: view([row('thread-1', 0.125, 0, 1), row('thread-2', 0.25, 2)]) } },
  });
  flushSync();
  expect(badge()).toBeNull();
  expect(document.querySelector('[data-work-peek]')).toBeNull();
});
