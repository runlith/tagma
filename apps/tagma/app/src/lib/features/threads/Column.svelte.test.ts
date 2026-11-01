// @vitest-environment jsdom

import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@runlith/testing/flush';
import { AgentTypes } from './AgentTypes.svelte.js';
import { ThreadChats } from './ThreadChats.js';
import { ModelDefaults } from './ModelDefaults.svelte.js';
import { keyedBy, liveFeed, mountShell, screen, soloWorkspace, threadsRepo, type TestApp } from '$lib/app/testing.js';
import { testThreadSlot } from '$lib/app/slotWorld.js';
import { AreaFrame } from '$lib/app/panes/AreaFrame.svelte.js';
import { PaneRegistry } from '$lib/app/panes/PaneRegistry.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
import { View } from '$lib/features/executions/load/View.svelte.js';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { testProviderCatalog } from '$lib/features/providers/testing.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { Finishing } from '$lib/features/worktrees/Finishing.svelte.js';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { AgentsColumn } from './AgentsColumn.svelte.js';
import SeatedFrame from './AgentsFrame.fixture.svelte';
import { ArchivedThreadsOpen } from './ArchivedThreadsOpen.svelte.js';
import { CallActivity } from './CallActivity.svelte.js';
import Column from './Column.svelte';
import { ThreadSeats } from './seats/ThreadSeats.svelte.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';
import { threadPeeks } from './threadPeek.svelte.js';
import { ThreadList } from './List.svelte.js';
import { FolderActs } from './FolderActs.js';
import { MentionDrops } from './MentionDrops.svelte.js';
import { ThreadOnScreen } from './OnScreen.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { ThreadFolds } from './threadFolds.svelte.js';
import { WorkLines } from './workLines.svelte.js';

let app: TestApp | undefined;
const feed = liveFeed();

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.line === undefined ? (this.dataset.drop === 'loose' ? 27 : 0) : 26;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.getAttribute('data-drop') === 'loose' ? 27 : 0;
  });
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return Number.parseFloat(this.querySelector<HTMLElement>('[data-line]')?.parentElement?.style.height ?? '') || 0;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
      this.scrollTop = typeof options === 'number' ? (y ?? options) : (options?.top ?? this.scrollTop);
      this.dispatchEvent(new Event('scroll'));
    },
  });
});

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  feed.frame = null;
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

const row = (index: number): ThreadListRow => ({
  id: `t-${index}`,
  projectId: 1,
  scopeName: null,
  title: `Thread ${index}`,
  titleOrigin: 'random',
  life: 'idle',
  activeRunId: null,
  activeRunStartedAt: null,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: null,
  outcome: null,
  spawnRootId: `t-${index}`,
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
  processAccount: null,
  provider: 'subscription',
  model: 'claude-opus-5',
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - index * 60_000).toISOString(),
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function shell(): { shown: TestApp; host: ThreadSlot } {
  const shown = mountShell(
    Layer.mergeAll(
      ThreadList,
      FolderActs,
      ThreadFolds,
      ArchivedThreadsOpen,
      MentionDrops,
      WorkLines,
      Seams,
      AreaFrame,
      ReaderMarks,
      WallClock,
      Notices,
      ThreadNames,
      CommandActivity,
      CallActivity,
      screen(),
      SidePanes,
      ThreadSeats,
      AgentsColumn,
      Panes,
      PaneRegistry,
      Readings,
      View,
      ExecutionActs,
    ),
    Layer.mergeAll(
      Layer.of(
        ThreadsRepo,
        threadsRepo({
          roots: keyedBy(async () => undefined),
          archived: keyedBy(async () => ({ status: 'rows', rows: [], total: 0 })),
          conversations: { key: () => ({ data: undefined, error: undefined, isFetching: false, cancel: () => undefined }) },
        }),
      ),
      Layer.of(ExecutionsRepo, { inventory: stubFamily(), commands: stubFamily() } as never),
      Layer.of(SettingsRepo, { catalog: stubFamily() } as never),
      Layer.of(Live, feed.live),
      Layer.of(ThreadChats, {} as never),
      Layer.of(AgentTypes, {
        rows: null,
        launches: [],
        agents: [],
        rejected: [],
        defaultType: 'tagma',
        served: new Set(),
        read: async () => undefined,
      } as never),
      Layer.of(ModelDefaults, { value: null } as never),
      Layer.of(ProviderCatalog, testProviderCatalog()),
      Layer.of(Workspace, soloWorkspace({ contextProject: { rootPath: '/repo' }, find: () => ({ rootPath: '/repo' }) })),
      Layer.of(Door, { ask: () => Promise.reject(new Error('this suite makes no call')) } as never),
      Layer.of(Failure, new Failure(() => undefined)),
      Layer.of(Finishing, { departed: [] } as never),
    ),
  );
  app = shown;
  const list = shown.app.resolve(ThreadList);
  return { shown, host: testThreadSlot({ list }, {}, shown.app.scopeOf('app')) };
}

const listed = (rows: readonly ThreadListRow[]): void =>
  feed.routes.get('threads.subscribe')?.({ type: 'list', rows, roots: rows.length, windowBefore: null });

function mounted(): HTMLElement {
  const { shown, host } = shell();
  const target = shown.draw(Column as never, { host });
  flushSync();
  const scroller = target.querySelector<HTMLElement>('[data-drop="loose"]');
  if (scroller === null) throw new Error('The column drew no list.');
  Object.defineProperty(scroller, 'clientHeight', { value: 27 });
  scroller.dispatchEvent(new Event('scroll'));
  listed(Array.from({ length: 40 }, (_unused, index) => row(index)));
  flushSync();
  return target;
}

const drawn = (target: HTMLElement): string[] =>
  [...target.querySelectorAll<HTMLAnchorElement>('a[data-thread]')].map((anchor) => anchor.dataset.thread ?? '');

const scrollTo = (target: HTMLElement, index: number): void => {
  const scroller = target.querySelector<HTMLElement>('[data-drop="loose"]');
  if (scroller === null) throw new Error('The column drew no list.');
  scroller.scrollTop = index * 27;
  scroller.dispatchEvent(new Event('scroll'));
  flushSync();
};

test('the column windows its rows, keeps a row being renamed across scrolls, and reaches an unmounted row by keyboard', async () => {
  const target = mounted();
  const shown = drawn(target);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(40);
  expect(shown).toContain('t-0');
  expect(shown).not.toContain('t-39');

  const title = target.querySelector('a[data-thread="t-0"] [data-squeeze-title]');
  if (title === null) throw new Error('The column drew no title.');
  for (let press = 0; press < 2; press += 1) title.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, button: 0 }));
  flushSync();
  const input = target.querySelector<HTMLInputElement>('input[aria-label="Thread title"]');
  expect(input).not.toBeNull();
  const typed = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
  input?.dispatchEvent(typed);
  expect(typed.defaultPrevented).toBe(false);

  scrollTo(target, 20);
  const later = drawn(target);
  expect(later).toContain('t-20');
  expect(later).not.toContain('t-1');
  expect(later).not.toContain('t-39');
  expect(target.querySelector('input[aria-label="Thread title"]')).not.toBeNull();

  const middle = target.querySelector<HTMLElement>('a[data-thread="t-20"]');
  middle?.focus();
  middle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await tick();
  expect((document.activeElement as HTMLElement | null)?.dataset.thread).toBe('t-39');
  expect(drawn(target)).not.toContain('t-1');

  const filter = target.querySelector<HTMLInputElement>('input[aria-label="Search agents"]');
  if (filter === null) throw new Error('The column drew no filter.');
  filter.value = 'matches-no-thread';
  filter.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(drawn(target)).toEqual([]);
  const hit = document.createElement('button');
  hit.dataset.fold = 'hit';
  target.querySelector('[data-drop="loose"]')?.append(hit);
  filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(hit);

  threadPeeks.toggle(threadPeeks.key('t-5'));
  expect(threadPeeks.openId).not.toBeNull();
  await app?.unmount();
  app = undefined;
  expect(threadPeeks.openId).toBeNull();
});

test('the agents column leaves when the page gives up the main seat in the same update that redraws its rows', () => {
  const { shown, host } = shell();
  const page = $state({ open: true });
  const target = shown.draw(SeatedFrame as never, { host, page });
  listed([row(0), row(1)]);
  flushSync();
  expect(target.querySelector('a[data-thread="t-0"]')).not.toBeNull();

  listed([row(0), row(1)].map((line) => ({ ...line, title: `${line.title} renamed` })));
  page.open = false;
  flushSync();
  expect(target.querySelector('aside[aria-label="Agents"]')).toBeNull();
});

test('a thread opened elsewhere is unfolded from its team and scrolled into the column without taking focus', async () => {
  const { shown, host } = shell();
  const target = shown.draw(Column as never, { host });
  flushSync();
  const scroller = target.querySelector<HTMLElement>('[data-drop="loose"]');
  if (scroller === null) throw new Error('The column drew no list.');
  Object.defineProperty(scroller, 'clientHeight', { value: 27 });
  scroller.dispatchEvent(new Event('scroll'));
  const member = { ...row(40), parentThreadId: 't-30', spawnRootId: 't-30' };
  listed([...Array.from({ length: 40 }, (_unused, index) => row(index)), member]);
  flushSync();
  expect(drawn(target)).not.toContain(member.id);

  host.activateRoute(member.id, 1);
  await waitFor(() => expect(drawn(target)).toContain(member.id));
  expect(drawn(target)).not.toContain('t-0');
  expect((document.activeElement as HTMLElement | null)?.dataset.thread).toBeUndefined();
});
