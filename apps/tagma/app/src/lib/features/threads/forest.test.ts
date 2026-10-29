import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { expect, test } from 'vitest';
import { feedOrder, type RowOrder, ThreadForest, type ThreadTreeNode } from './forest.js';

type Clocks = { readerOrderAt?: string; pinnedAt?: string | null; finishedAt?: string; phase?: ThreadListRow['phase'] };

const row = (id: string, life: RunLife, parentThreadId: string | null, clocks: Clocks = {}): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life,
  activeRunId: life === 'idle' ? null : `run:${id}`,
  activeRunStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
  outcome:
    clocks.finishedAt === undefined
      ? null
      : {
          runId: `run:${id}`,
          status: 'completed',
          failureReason: null,
          failure: null,
          hostStateFailure: false,
          finishedAt: clocks.finishedAt,
          isSeen: false,
        },
  spawnRootId: 'root',
  parentThreadId,
  name: id,
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: clocks.phase ?? null,
  held: { paths: 0, unproven: 0 },
  provider: 'anthropic',
  account: null,
  processAccount: null,
  model: null,
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: clocks.readerOrderAt ?? '2026-01-01T00:00:00.000Z',
  pinnedAt: clocks.pinnedAt ?? null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const stamp = (minutes: number): string => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();

function nodesOf(forest: ThreadForest): ThreadTreeNode[] {
  const all: ThreadTreeNode[] = [];
  const walk = (node: ThreadTreeNode): void => {
    all.push(node);
    node.children.forEach(walk);
  };
  forest.roots.forEach(walk);
  return all;
}

function shapeOf(nodes: readonly ThreadTreeNode[]): unknown {
  return nodes.map((node) => ({
    id: node.row.id,
    life: node.life,
    below: node.lifeBelow,
    event: node.lastEventAt,
    live: node.liveSince,
    team: node.team,
    children: shapeOf(node.children),
  }));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

test('a forest fed change by change stands exactly as one built from the rows it ends with', () => {
  const random = seeded(7);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const lives: RunLife[] = ['idle', 'working', 'awaiting', 'stalled'];
  const forest = new ThreadForest();
  const held = new Map<string, ThreadListRow>();

  for (let step = 0; step < 400; step += 1) {
    const ids = [...held.keys()];
    const roll = random();
    if (ids.length > 0 && roll < 0.12) {
      const gone = pick(ids);
      held.delete(gone);
      forest.remove(gone);
    } else {
      const id = ids.length > 0 && roll < 0.7 ? pick(ids) : `t${step}`;
      const elders = ids.filter((other) => Number(other.slice(1)) < Number(id.slice(1)));
      const parent = random() < 0.3 || elders.length === 0 ? null : random() < 0.1 ? `absent${step % 4}` : pick(elders);
      const next = row(id, pick(lives), parent, {
        readerOrderAt: stamp(Math.floor(random() * 30)),
        pinnedAt: random() < 0.15 ? stamp(1) : null,
        finishedAt: random() < 0.2 ? stamp(Math.floor(random() * 60)) : undefined,
      });
      held.set(id, next);
      forest.put(next);
    }
    const fresh = new ThreadForest();
    for (const entry of [...held.values()].reverse()) fresh.put(entry);
    expect(shapeOf(forest.roots)).toEqual(shapeOf(fresh.roots));
  }
  expect(forest.rows().map((entry) => entry.id)).toEqual([...held.values()].sort(feedOrder).map((entry) => entry.id));
});

function wide(children: number): { forest: ThreadForest; leaf: (index: number) => ThreadListRow } {
  const forest = new ThreadForest();
  const leaf = (index: number) => row(`leaf-${index}`, 'idle', 'lead', { readerOrderAt: stamp(index % 600) });
  forest.put(row('lead', 'working', null, { readerOrderAt: stamp(700) }));
  for (let index = 0; index < children; index += 1) forest.put(leaf(index));
  for (let index = 0; index < 20; index += 1) {
    forest.put(row(`other-${index}`, 'idle', null, { readerOrderAt: stamp(index) }));
    forest.put(row(`other-${index}-child`, 'idle', `other-${index}`, { readerOrderAt: stamp(index) }));
  }
  return { forest, leaf };
}

test('a change to one thread rebuilds its path alone: every node off the path keeps its identity', () => {
  const { forest, leaf } = wide(60);
  const before = new Map(nodesOf(forest).map((node) => [node.row.id, node]));

  forest.put({ ...leaf(30), phase: { phase: 'tools', calls: [] } as never });

  const after = new Map(nodesOf(forest).map((node) => [node.row.id, node]));
  const changed = [...after].filter(([id, node]) => before.get(id) !== node).map(([id]) => id);
  expect(changed.sort()).toEqual(['lead', 'leaf-30']);
  expect(forest.roots.map((node) => node.row.id)).toEqual(['lead', ...Array.from({ length: 20 }, (_, i) => `other-${19 - i}`)]);
});

test('a sort key that moves a thread moves its node among the siblings without recreating them', () => {
  const { forest, leaf } = wide(40);
  const before = new Map(nodesOf(forest).map((node) => [node.row.id, node]));

  forest.put({ ...leaf(5), readerOrderAt: stamp(900) });

  const lead = forest.node('lead');
  expect(lead?.children[0]?.row.id).toBe('leaf-5');
  const after = new Map(nodesOf(forest).map((node) => [node.row.id, node]));
  const changed = [...after].filter(([id, node]) => before.get(id) !== node).map(([id]) => id);
  expect(changed.sort()).toEqual(['lead', 'leaf-5']);
});

test('a thread whose parent arrives later joins it, and leaves it again when the parent goes', () => {
  const forest = new ThreadForest();
  forest.put(row('child', 'working', 'parent'));
  expect(forest.roots.map((node) => node.row.id)).toEqual(['child']);

  forest.put(row('parent', 'idle', null));
  expect(forest.roots.map((node) => node.row.id)).toEqual(['parent']);
  expect(forest.node('parent')?.lifeBelow).toBe('working');

  forest.remove('parent');
  expect(forest.roots.map((node) => node.row.id)).toEqual(['child']);
});

test('active descendants keep idle ancestors live until the last one settles, moves or is removed', () => {
  const forest = new ThreadForest();
  for (const held of [row('root', 'idle', null), row('middle', 'idle', 'root'), row('quiet', 'idle', null, { readerOrderAt: stamp(1) })])
    forest.put(held);
  const roots = () => forest.roots.map((node) => node.row.id);

  for (const life of ['working', 'stalled', 'awaiting'] as const) {
    forest.put(row('leaf', life, 'middle'));
    expect(forest.node('middle')?.lifeBelow).toBe(life);
    expect(forest.node('root')?.lifeBelow).toBe(life);
    expect(roots()).toEqual(['root', 'quiet']);
  }
  forest.put(row('other', 'stalled', 'middle'));
  forest.put(row('leaf', 'idle', 'middle'));
  expect(forest.node('root')?.lifeBelow).toBe('stalled');
  expect(roots()).toEqual(['root', 'quiet']);

  forest.put(row('other', 'stalled', 'quiet'));
  expect(forest.node('root')?.lifeBelow).toBe('idle');
  expect(forest.node('quiet')?.lifeBelow).toBe('stalled');
  expect(roots()).toEqual(['quiet', 'root']);

  forest.remove('other');
  expect(forest.node('quiet')?.lifeBelow).toBe('idle');
});

test('a grandchild between turns that is owed its own command end counts as working for every ancestor until the end arrives', () => {
  const forest = new ThreadForest();
  for (const held of [row('root', 'idle', null), row('middle', 'idle', 'root')]) forest.put(held);

  forest.put({ ...row('tester', 'idle', 'middle', { finishedAt: stamp(1) }), owes: true });
  for (const id of ['middle', 'root']) {
    expect(forest.node(id)?.team).toMatchObject({ working: 1, unseen: 0, workers: ['tester'] });
    expect(forest.node(id)?.lifeBelow).toBe('working');
  }

  forest.put(row('tester', 'idle', 'middle', { finishedAt: stamp(1) }));
  expect(forest.node('root')?.team).toMatchObject({ working: 0, unseen: 1, workers: [] });
  expect(forest.node('root')?.lifeBelow).toBe('idle');
});

test('a thread naming its own descendant as parent stands as a root instead of vanishing', () => {
  const forest = new ThreadForest();
  forest.put(row('a', 'idle', null));
  forest.put(row('b', 'idle', 'a'));
  forest.put(row('a', 'idle', 'b'));

  expect(forest.roots.map((node) => node.row.id)).toEqual(['a']);
  expect(forest.node('a')?.children.map((node) => node.row.id)).toEqual(['b']);
});

function comparisons(children: number): number {
  let count = 0;
  const counting: RowOrder = (left, right) => {
    count += 1;
    return feedOrder(left, right);
  };
  const forest = new ThreadForest(counting);
  forest.put(row('lead', 'working', null, { readerOrderAt: stamp(700) }));
  for (let index = 0; index < children; index += 1) {
    forest.put(row(`leaf-${index}`, 'idle', 'lead', { readerOrderAt: stamp(index % 600) }));
  }
  const target = row('leaf-1', 'idle', 'lead', { readerOrderAt: stamp(1) });
  count = 0;
  forest.put({ ...target, phase: { phase: 'tools', calls: [] } as never });
  return count;
}

test('the work for one change grows with the logarithm of the siblings, not their number', () => {
  const narrow = comparisons(5);
  const broad = comparisons(500);
  expect(broad).toBeLessThanOrEqual(narrow * 6 + 10);
  expect(broad).toBeLessThan(60);
});
