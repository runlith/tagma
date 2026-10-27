// @vitest-environment jsdom
import type { WorktreeFact, WorktreePlace, WorktreeRow, WorktreeState } from '@tagma/server/worktrees/contract/wire/rows';
import { Layer } from '@runlith/layer/Layer';
import { stubAll, stubMutation, stubSingle } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Worktrees } from './BoardState.svelte.js';
import { Cleanup } from './Cleanup.svelte.js';
import { Finishing } from './Finishing.svelte.js';
import WorktreeBoard from './WorktreeBoard.svelte';

const CURRENT: WorktreeFact = { state: 'current', head: 'h', base: 'b', baseTime: null, takenAt: 0 };

let index = 0;

const place = (name: string, over: Partial<WorktreePlace> = {}): WorktreePlace => ({
  index: index++,
  rootId: `root-${name}` as WorktreePlace['rootId'],
  kind: 'tagma',
  name,
  folder: `/repo/.worktrees/${name}`,
  branch: name,
  base: { branch: 'main', commit: 'base' },
  hue: 1,
  head: 'h',
  headTime: 0,
  missing: false,
  agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
  threads: [],
  setup: 'done',
  taskId: null,
  pending: null,
  movedAt: '2026-10-27T10:00:00.000Z',
  ...over,
});

const facts = (row: WorktreePlace, status: WorktreeState, over: Partial<WorktreeRow> = {}): WorktreeRow => ({
  ...row,
  status,
  check: 'clean',
  ahead: 0,
  behind: 0,
  uncommitted: 0,
  reading: 'done',
  diff: null,
  stateFact: CURRENT,
  mergeFact: CURRENT,
  ...over,
});

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('the board groups worktrees by their next step, says each state in one phrase, offers one step, and keeps the order while pointed at', () => {
  const main = place('main', { kind: 'main', base: null, hue: null });
  const ready = place('ready', { movedAt: '2026-10-27T12:00:00.000Z', threads: ['thread-ready'] });
  const behind = place('behind');
  const busy = place('busy', { agents: { working: 2, waiting: 0, finished: 0, standing: 2 } });
  const quiet = place('quiet');
  const merged = place('merged');
  const gone = place('gone', { missing: true });
  const rows = [main, ready, behind, busy, quiet, merged, gone];
  let read = $state.raw(
    new Map<string, WorktreeRow>([
      [main.rootId, facts(main, 'idle', { uncommitted: 3 })],
      [ready.rootId, facts(ready, 'ready', { ahead: 6 })],
      [behind.rootId, facts(behind, 'behind', { behind: 4, mergeFact: { ...CURRENT, state: 'previous' } })],
      [busy.rootId, facts(busy, 'idle', { uncommitted: 5 })],
      [quiet.rootId, facts(quiet, 'idle')],
      [merged.rootId, facts(merged, 'merged')],
    ]),
  );
  const learn = (row: WorktreeRow): void => {
    read = new Map(read).set(row.rootId, row);
  };
  const places = {
    aim: { projectId: 1 },
    rows,
    main,
    aimed: main,
    unread: null,
    byRoot: (rootId: string) => rows.find((row) => row.rootId === rootId) ?? null,
    window: () => ({ unread: null, rowOf: (rootId: string) => read.get(rootId) ?? null, observe: () => () => undefined }),
  };
  app = mountShell(
    Layer.mergeAll(
      Layer.of(Worktrees, places as never),
      Layer.of(Finishing, { inFlight: () => null, outcomeOf: () => null, leaving: () => false, departed: [] } as never),
      Layer.of(Cleanup, { show: () => undefined } as never),
      Layer.of(
        ThreadNames,
        new ThreadNames((id) => (id === 'thread-ready' ? { label: 'Fix the build', archived: false, harness: false } : null)),
      ),
      Layer.of(Workspace, { find: () => undefined } as never),
      WallClock,
    ),
    Layer.of(SettingsRepo, {
      catalog: { name: 'stub', key: () => stubSingle({}), all: stubAll, reset: () => undefined },
      write: stubMutation(),
    } as never),
  );
  const page = app.draw(WorktreeBoard as never);
  flushSync();

  const groups = () =>
    [...page.querySelectorAll('section[data-board-group]')].map((section) => [
      section.getAttribute('data-board-group'),
      [...section.querySelectorAll('[data-board-row]')].map((row) => row.getAttribute('data-board-row')),
    ]);
  const rowOf = (name: string) => page.querySelector(`[data-board-row="${name}"]`);
  const phrase = (name: string) => rowOf(name)?.querySelector('[data-board-phrase]')?.getAttribute('data-board-phrase') ?? null;
  const steps = (name: string) =>
    [...(rowOf(name)?.querySelectorAll('[data-board-step]') ?? [])].map((one) => one.getAttribute('data-board-step'));

  expect(groups()).toEqual([
    ['needs', ['ready', 'behind']],
    ['working', ['busy']],
    ['quiet', ['quiet']],
    ['clean', ['merged', 'gone']],
  ]);
  expect(rows.map((row) => [row.name, phrase(row.name), steps(row.name)])).toEqual([
    ['main', 'uncommitted', []],
    ['ready', 'ready', ['merge']],
    ['behind', 'behind', ['update']],
    ['busy', 'uncommitted', []],
    ['quiet', 'nothing', []],
    ['merged', 'merged', ['delete']],
    ['gone', 'gone', ['delete']],
  ]);
  expect(rowOf('ready')?.querySelector('[data-board-what]')?.textContent).toBe('Fix the build');

  const list = page.querySelector('[data-board-list]');
  list?.dispatchEvent(new Event('pointerenter'));
  learn(facts(quiet, 'ready', { ahead: 1 }));
  flushSync();
  expect(groups()[2]).toEqual(['quiet', ['quiet']]);
  expect(phrase('quiet')).toBe('ready');

  list?.dispatchEvent(new Event('pointerleave'));
  flushSync();
  expect(groups()[0]).toEqual(['needs', ['ready', 'behind', 'quiet']]);
});
