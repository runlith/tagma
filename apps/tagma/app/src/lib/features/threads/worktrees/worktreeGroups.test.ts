import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { expect, test } from 'vitest';
import { ThreadForest, type ThreadTreeNode, threadTree } from '../forest.js';
import { foldTeam } from '../tree.js';
import { type MemberPlaces, worktreeGroups } from './worktreeGroups.js';

const thread = (id: string, parentThreadId: string | null): ThreadListRow =>
  ({
    id,
    projectId: 1,
    scopeName: null,
    title: id,
    titleOrigin: 'random',
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    activeRunSelection: null,
    contextShare: null,
    cacheWarmth: null,
    liveSpellStartedAt: null,
    outcome: null,
    spawnRootId: 'root',
    parentThreadId,
    name: id,
    agentId: 'tagma',
    profileId: null,
    harness: null,
    phase: null,
    held: { paths: 0, unproven: 0 },
    provider: 'anthropic',
    account: null,
    model: null,
    reasoning: null,
    switches: {},
    createdBySessionId: null,
    readerOrderAt: '2026-01-01T00:00:00.000Z',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as ThreadListRow;

const worktree = (rootId: string, kind: WorktreePlace['kind']): WorktreePlace =>
  ({ rootId, kind, name: rootId, branch: rootId, threads: [] }) as unknown as WorktreePlace;

const drawn = (trees: readonly ThreadTreeNode[]): string[] => trees.flatMap((node) => [node.row.id, ...drawn(node.children)]);

const member = (
  rows: readonly WorktreePlace[],
  placeOf: MemberPlaces['placeOf'],
  creatingOf: MemberPlaces['creatingOf'] = () => null,
  projectId = 1,
): MemberPlaces => ({ projectId, rows, placeOf, creatingOf });

const main = worktree('main', 'main');
const sidebar = worktree('sidebar', 'tagma');
const terminal = worktree('terminal', 'tagma');
const gone = worktree('gone', 'tagma');

const threads = [
  thread('lead', null),
  thread('reviewer', 'lead'),
  thread('fixer', 'lead'),
  thread('helper', 'fixer'),
  thread('stray', null),
  thread('quiet', null),
];
const places: Record<string, WorktreePlace> = {
  lead: sidebar,
  reviewer: sidebar,
  fixer: terminal,
  helper: sidebar,
  stray: gone,
};
const grouping = worktreeGroups(threadTree(threads), [member([main, sidebar, terminal], (id) => places[id] ?? main)]);
const trees = (rootId: string) => grouping.groups.find((group) => group.row.rootId === rootId)?.trees ?? [];

test('every loaded thread is drawn exactly once, and one whose place is not a drawn group stands in main', () => {
  const all = grouping.groups.flatMap((group) => drawn(group.trees));
  expect([...all].sort()).toEqual(threads.map((row) => row.id).sort());
  expect(drawn(trees('main')).sort()).toEqual(['quiet', 'stray']);
});

test('a child standing apart from its parent roots its own group with a crumb, and its parent keeps a row per worktree it went to', () => {
  expect(drawn(trees('terminal'))).toEqual(['fixer']);
  expect(grouping.crumbs.get('fixer')).toEqual({ parent: threads[0], row: sidebar });
  expect(
    trees('sidebar')
      .find((node) => node.row.id === 'lead')
      ?.children.map((node) => node.row.id),
  ).toEqual(['reviewer']);
  expect(grouping.away.get('lead')).toEqual([{ row: terminal, threads: ['fixer'] }]);
});

test('a thread the listing places in no tree stands apart from every group, and not in main', () => {
  const apart = worktreeGroups(threadTree([thread('placed', null), thread('cleared', null)]), [
    member([main, sidebar], (id) => (id === 'cleared' ? null : sidebar)),
  ]);
  expect(drawn(apart.nowhere)).toEqual(['cleared']);
  expect(apart.groups.flatMap((group) => drawn(group.trees))).toEqual(['placed']);
});

test('a thread whose new worktree is still being made stands under that creation, not under main', () => {
  const coming = worktreeGroups(threadTree([thread('born', null), thread('quiet', null)]), [
    member(
      [main],
      () => main,
      (row) => (row.id === 'born' ? 'creation-1' : null),
    ),
  ]);
  expect(drawn(coming.creating.get('creation-1') ?? [])).toEqual(['born']);
  expect(coming.groups.flatMap((group) => drawn(group.trees))).toEqual(['quiet']);
});

test('in a group every thread stands under its own member’s places, and each member’s places follow the group order', () => {
  const theirs = worktree('their-main', 'main');
  const feature = worktree('their-feature', 'tagma');
  const split = worktreeGroups(
    threadTree([thread('ours', null), { ...thread('theirs', null), projectId: 2 }, { ...thread('their-work', null), projectId: 2 }]),
    [
      member([main, sidebar], () => main),
      member(
        [theirs, feature],
        (id) => (id === 'their-work' ? feature : theirs),
        () => null,
        2,
      ),
    ],
  );

  expect(split.groups.map((group) => [group.projectId, group.row.rootId, drawn(group.trees)])).toEqual([
    [1, 'main', ['ours']],
    [1, 'sidebar', []],
    [2, 'their-main', ['theirs']],
    [2, 'their-feature', ['their-work']],
  ]);
});

test('a chain that crosses back keeps a crumb at every crossing', () => {
  expect(trees('sidebar').map((node) => node.row.id)).toContain('helper');
  expect(grouping.crumbs.get('helper')?.parent.id).toBe('fixer');
  expect(grouping.away.get('fixer')).toEqual([{ row: sidebar, threads: ['helper'] }]);
  expect(grouping.crumbs.has('reviewer')).toBe(false);
});

test('an active descendant in another worktree keeps its idle ancestors outside finished', () => {
  const forest = new ThreadForest();
  forest.put(thread('root', null));
  forest.put(thread('middle', 'root'));
  forest.put({ ...thread('quiet', null), readerOrderAt: '2026-01-01T01:00:00.000Z' });

  for (const life of ['working', 'awaiting', 'stalled', 'idle'] as const) {
    forest.put({
      ...thread('leaf', 'middle'),
      life,
      activeRunId: life === 'idle' ? null : 'run-leaf',
      activeRunStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
      liveSpellStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
    });
    const split = worktreeGroups(forest.roots, [member([main, sidebar], (id) => (id === 'leaf' ? sidebar : main))]);
    const local = split.groups.find((group) => group.row.rootId === 'main')!.trees;
    const root = local.find((node) => node.row.id === 'root')!;
    const fold = foldTeam(root.children);

    expect(local.map((node) => node.row.id)).toEqual(life === 'idle' ? ['quiet', 'root'] : ['root', 'quiet']);
    expect(fold.standing.map((node) => node.row.id)).toEqual(life === 'idle' ? [] : ['middle']);
    expect(fold.finished.map((node) => node.row.id)).toEqual(life === 'idle' ? ['middle'] : []);
    expect(root.team.size).toBe(1);
    expect(root.children[0]?.team.size).toBe(0);
    expect(drawn(split.groups.find((group) => group.row.rootId === 'sidebar')!.trees)).toEqual(['leaf']);
  }
});

test('a group reuses the forest nodes wholly inside it, and a parent split across worktrees counts only the children that stayed', () => {
  const source = threadTree(threads);
  const split = worktreeGroups(source, [member([main, sidebar, terminal], (id) => places[id] ?? main)]);
  const inMain = split.groups.find((group) => group.row.rootId === 'main')?.trees ?? [];
  const lead = split.groups.find((group) => group.row.rootId === 'sidebar')?.trees.find((node) => node.row.id === 'lead');

  expect(inMain.find((node) => node.row.id === 'quiet')).toBe(source.find((node) => node.row.id === 'quiet'));
  expect(source.find((node) => node.row.id === 'lead')?.team.size).toBe(3);
  expect(lead?.team.size).toBe(1);
});
