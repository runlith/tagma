import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { expect, test } from 'vitest';
import { ThreadForest, type ThreadTreeNode, bandedTree, threadTree } from './forest.js';
import { columnEntries, foldTeam, matchThreads, nextWaiting } from './tree.js';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';

const NO_MODELS = modelCatalog<ServedProvider>([]);

const TERMINAL = {
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
} as const;

const row = (
  id: string,
  life: RunLife,
  parentThreadId: string | null,
  clocks: {
    runStartedAt?: string;
    spellStartedAt?: string;
    readerOrderAt?: string;
    finishedAt?: string;
    pinnedAt?: string;
  } = {},
): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life,
  activeRunId: life === 'idle' ? null : `run:${id}`,
  activeRunStartedAt: life === 'idle' ? null : (clocks.runStartedAt ?? '2026-01-01T00:00:00.000Z'),
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: clocks.spellStartedAt ?? (life === 'idle' ? null : (clocks.runStartedAt ?? '2026-01-01T00:00:00.000Z')),
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
          isSeen: true,
        },
  spawnRootId: 'root',
  parentThreadId,
  name: id,
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
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

test('filtering retains deep matches and ancestors but not unrelated siblings or descendants', () => {
  const source = threadTree([
    row('root', 'idle', null),
    row('middle', 'idle', 'root'),
    row('agents-prototype', 'idle', 'middle'),
    row('unmatched-child', 'idle', 'agents-prototype'),
    row('sibling', 'working', 'middle'),
    row('other-root', 'idle', null),
  ]);
  const result = matchThreads(NO_MODELS, source, ' PROTOTYPE ');
  expect(result.map((node) => node.row.id)).toEqual(['root']);
  expect(result[0]?.children.map((node) => node.row.id)).toEqual(['middle']);
  expect(result[0]?.children[0]?.children.map((node) => node.row.id)).toEqual(['agents-prototype']);
  expect(result[0]?.children[0]?.children[0]?.children).toEqual([]);
  expect(source[0]?.children[0]?.children.map((node) => node.row.id)).toEqual(['agents-prototype', 'sibling']);
  expect(source[0]?.children[0]?.children[0]?.children[0]?.row.id).toBe('unmatched-child');
  expect(matchThreads(NO_MODELS, source, '')).toBe(source);
  expect(matchThreads(NO_MODELS, source, 'absent')).toEqual([]);
});

test('a parent match keeps only descendants that match independently, including finished agents', () => {
  const source = threadTree([
    row('prototype-root', 'idle', null),
    { ...row('prototype-finished', 'idle', 'prototype-root'), outcome: ended('completed', true, '2026-01-01T01:00:00.000Z') },
    row('unrelated', 'working', 'prototype-root'),
  ]);
  const result = matchThreads(NO_MODELS, source, 'prototype');
  expect(result[0]?.row.id).toBe('prototype-root');
  expect(result[0]?.children.map((node) => node.row.id)).toEqual(['prototype-finished']);
  expect(result[0]?.children[0]?.row.outcome?.status).toBe('completed');
  expect(matchThreads(NO_MODELS, source, 'prototype-root')[0]?.children).toEqual([]);
});

test('model matches retain the path to the running selection rather than its next-turn selection', () => {
  const source = threadTree([
    row('root', 'idle', null),
    {
      ...row('builder', 'working', 'root'),
      provider: 'subscription',
      model: 'claude-opus-5',
      activeRunSelection: { provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: 'high' },
    },
  ]);
  expect(matchThreads(NO_MODELS, source, 'sol')[0]?.children.map((node) => node.row.id)).toEqual(['builder']);
  expect(matchThreads(NO_MODELS, source, 'opus')).toEqual([]);
});

function lifeBelow(rows: readonly ThreadListRow[]): Record<string, RunLife> {
  const answer: Record<string, RunLife> = {};
  const walk = (node: ThreadTreeNode): void => {
    answer[node.row.id] = node.lifeBelow;
    for (const child of node.children) walk(child);
  };
  for (const node of threadTree(rows)) walk(node);
  return answer;
}

test('a working descendant lights every chevron above it, and none below it', () => {
  const answer = lifeBelow([row('root', 'idle', null), row('mid', 'idle', 'root'), row('leaf', 'working', 'mid')]);

  expect(answer).toEqual({ root: 'working', mid: 'working', leaf: 'idle' });
});

test('a descendant waiting on a person outranks one that is only working', () => {
  const siblings = lifeBelow([row('root', 'idle', null), row('busy', 'working', 'root'), row('asker', 'awaiting', 'root')]);
  expect(siblings.root).toBe('awaiting');

  const nested = lifeBelow([row('root', 'idle', null), row('busy', 'working', 'root'), row('asker', 'awaiting', 'busy')]);
  expect(nested).toEqual({ root: 'awaiting', busy: 'awaiting', asker: 'idle' });
});

const banded = (rows: readonly ThreadListRow[]): readonly string[] => bandedTree(rows).map((node) => node.row.id);

test('a live tree stands above a quiet one whatever the reader clock says, oldest spell first', () => {
  const fresh = row('fresh', 'idle', null, { readerOrderAt: '2026-01-01T12:00:00.000Z' });
  const younger = row('younger', 'working', null, {
    runStartedAt: '2026-01-01T11:00:00.000Z',
    readerOrderAt: '2026-01-01T11:00:00.000Z',
  });
  const older = row('older', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    readerOrderAt: '2026-01-01T10:00:00.000Z',
  });

  expect(banded([fresh, younger, older])).toEqual(['older', 'younger', 'fresh']);
});

test('a tree live only through a descendant bands with the live, at its descendant’s instant', () => {
  const quiet = row('quiet', 'idle', null, { readerOrderAt: '2026-01-01T13:00:00.000Z' });
  const busy = row('busy', 'working', null, {
    runStartedAt: '2026-01-01T10:30:00.000Z',
    readerOrderAt: '2026-01-01T12:00:00.000Z',
  });
  const watched = row('watched', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const settled = row('settled', 'idle', 'watched', { readerOrderAt: '2026-01-01T09:30:00.000Z' });
  const helper = row('helper', 'working', 'watched', { runStartedAt: '2026-01-01T10:00:00.000Z' });
  const asker = row('asker', 'idle', null, { readerOrderAt: '2026-01-01T08:00:00.000Z' });
  const asking = row('asking', 'awaiting', 'asker', { runStartedAt: '2026-01-01T10:15:00.000Z' });

  const nodes = bandedTree([quiet, busy, watched, settled, helper, asker, asking]);

  expect(nodes.map((node) => node.row.id)).toEqual(['watched', 'asker', 'busy', 'quiet']);
  expect(nodes[0]?.children.map((child) => child.row.id)).toEqual(['settled', 'helper']);
});

test("a root's own run ending cannot move its tree while a child keeps the same spell alive", () => {
  const root = row('root', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    spellStartedAt: '2026-01-01T10:00:00.000Z',
  });
  const helper = row('helper', 'working', 'root', {
    runStartedAt: '2026-01-01T10:10:00.000Z',
    spellStartedAt: '2026-01-01T10:00:00.000Z',
  });
  const other = row('other', 'working', null, {
    runStartedAt: '2026-01-01T10:05:00.000Z',
    spellStartedAt: '2026-01-01T10:05:00.000Z',
  });

  expect(banded([other, root, helper])).toEqual(['root', 'other']);

  const settled = { ...root, life: 'idle' as const, activeRunId: null, activeRunStartedAt: null };
  expect(banded([other, settled, helper])).toEqual(['root', 'other']);
});

test("a tree that goes quiet and wakes again joins at the live band's foot", () => {
  const first = row('tree', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    spellStartedAt: '2026-01-01T10:00:00.000Z',
  });
  const other = row('other', 'working', null, {
    runStartedAt: '2026-01-01T11:00:00.000Z',
    spellStartedAt: '2026-01-01T11:00:00.000Z',
  });
  expect(banded([other, first])).toEqual(['tree', 'other']);

  const quiet = {
    ...first,
    life: 'idle' as const,
    activeRunId: null,
    activeRunStartedAt: null,
    liveSpellStartedAt: null,
  };
  expect(banded([other, quiet])).toEqual(['other', 'tree']);

  const next = row('tree', 'working', null, {
    runStartedAt: '2026-01-01T12:00:00.000Z',
    spellStartedAt: '2026-01-01T12:00:00.000Z',
  });
  expect(banded([next, other])).toEqual(['other', 'tree']);
});

test("a tree's finish lifts it over one the reader spoke to more recently", () => {
  const spoken = row('spoken', 'idle', null, { readerOrderAt: '2026-01-01T12:00:00.000Z' });
  const old = row('old', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const finished = row('finished', 'idle', null, {
    readerOrderAt: '2026-01-01T08:00:00.000Z',
    finishedAt: '2026-01-01T13:00:00.000Z',
  });

  expect(banded([spoken, old, finished])).toEqual(['finished', 'spoken', 'old']);
});

test("a child's finish lifts its root, and the stamps never increase down the band", () => {
  const root = row('root', 'idle', null, { readerOrderAt: '2026-01-01T07:00:00.000Z' });
  const helper = row('helper', 'idle', 'root', {
    readerOrderAt: '2026-01-01T07:00:00.000Z',
    finishedAt: '2026-01-01T14:00:00.000Z',
  });
  const spoken = row('spoken', 'idle', null, { readerOrderAt: '2026-01-01T12:00:00.000Z' });

  const nodes = bandedTree([spoken, root, helper]);
  expect(nodes.map((node) => node.row.id)).toEqual(['root', 'spoken']);
  const stamps = nodes.map((node) => node.lastEventAt);
  expect(stamps).toEqual([...stamps].sort().reverse());
});

test('a write nobody made moves nothing: a generated title is not an event', () => {
  const spoken = row('spoken', 'idle', null, { readerOrderAt: '2026-01-01T10:00:00.000Z' });
  const titled = row('titled', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const retitled = { ...titled, title: 'Named by the agent', updatedAt: '2026-01-01T23:00:00.000Z' };

  expect(banded([spoken, titled])).toEqual(['spoken', 'titled']);
  expect(banded([spoken, retitled])).toEqual(['spoken', 'titled']);
});

test('a tree that goes quiet takes the place its reader clock earned', () => {
  const quiet = row('quiet', 'idle', null, { readerOrderAt: '2026-01-01T13:00:00.000Z' });
  const watched = row('watched', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const working = row('helper', 'working', 'watched', { runStartedAt: '2026-01-01T10:00:00.000Z' });
  const done = row('helper', 'idle', 'watched', { readerOrderAt: '2026-01-01T09:00:00.000Z' });

  expect(banded([quiet, watched, working])).toEqual(['watched', 'quiet']);
  expect(banded([quiet, watched, done])).toEqual(['quiet', 'watched']);
});

type Outcome = NonNullable<ThreadListRow['outcome']>;
const ended = (status: Outcome['status'], isSeen: boolean, finishedAt: string): Outcome => ({
  runId: `run:${status}`,
  status,
  failureReason: null,
  failure: null,
  hostStateFailure: false,
  finishedAt,
  isSeen,
});
const JUST = '2026-01-01T00:00:00.000Z';
const member = (id: string, parent: string, state: RunLife | Outcome['status']): ThreadListRow =>
  state === 'idle' || state === 'working' || state === 'awaiting' || state === 'stalled'
    ? row(id, state, parent)
    : { ...row(id, 'idle', parent), outcome: ended(state, false, JUST) };
const teamFold = (rows: readonly ThreadListRow[]) => {
  const fold = foldTeam(threadTree([row('root', 'idle', null), ...rows])[0]?.children ?? []);
  const ids = (nodes: readonly ThreadTreeNode[]) => nodes.map((node) => node.row.id);
  return { standing: ids(fold.standing), moreWorking: ids(fold.moreWorking), finished: ids(fold.finished) };
};

test('every finished child folds at once, however fresh, and the fold keeps the handed order', () => {
  const children = Array.from({ length: 30 }, (_, index) => member(`done-${index}`, 'root', 'completed'));
  const fold = teamFold(children);

  expect(fold.standing).toEqual([]);
  expect(fold.moreWorking).toEqual([]);
  expect(fold.finished).toEqual(children.map((child) => child.id));
});

test('past five plain-working children the rest wait behind one row, while failed ones always draw', () => {
  const children = [
    member('failed-a', 'root', 'failed'),
    ...Array.from({ length: 12 }, (_, index) => member(`work-${index}`, 'root', 'working')),
    member('done-a', 'root', 'completed'),
    member('cut-b', 'root', 'cut'),
    ...Array.from({ length: 12 }, (_, index) => member(`work-${index + 12}`, 'root', 'working')),
    member('done-b', 'root', 'completed'),
    member('quiet', 'root', 'idle'),
    member('done-c', 'root', 'completed'),
  ];
  const fold = teamFold(children);

  expect(fold.standing).toEqual(['failed-a', 'work-0', 'work-1', 'work-2', 'work-3', 'work-4', 'cut-b']);
  expect(fold.moreWorking).toEqual(Array.from({ length: 19 }, (_, index) => `work-${index + 5}`));
  expect(fold.finished).toEqual(['done-a', 'done-b', 'quiet', 'done-c']);
});

test('opened, "more working" gives back every live child in the order it was handed', () => {
  const children = [
    ...Array.from({ length: 6 }, (_, index) => member(`work-${index}`, 'root', 'working')),
    member('failed-late', 'root', 'failed'),
    member('work-6', 'root', 'working'),
  ];
  const [root] = threadTree([row('root', 'idle', null), ...children]);
  const fold = foldTeam(root?.children ?? []);

  expect(fold.live.map((node) => node.row.id)).toEqual(children.map((child) => child.id));
  expect(fold.standing.map((node) => node.row.id)).toEqual(['work-0', 'work-1', 'work-2', 'work-3', 'work-4', 'failed-late']);
});

test('a finished child holding the open thread stays in the finished fold and is named as kept', () => {
  const [root] = threadTree([
    row('root', 'idle', null),
    member('done', 'root', 'completed'),
    member('lead', 'root', 'completed'),
    member('read', 'lead', 'completed'),
  ]);
  const ids = (nodes: readonly ThreadTreeNode[]) => nodes.map((node) => node.row.id);

  const kept = foldTeam(root?.children ?? [], 'read');
  expect(ids(kept.standing)).toEqual([]);
  expect(ids(kept.finished)).toEqual(['done', 'lead']);
  expect(kept.kept?.row.id).toBe('lead');
  expect(foldTeam(root?.children ?? [], null).kept).toBeNull();
});

test('a finished child stands on its descendants: live work, a wait or a failure below it', () => {
  const fold = teamFold([
    member('lead', 'root', 'completed'),
    member('grandchild', 'lead', 'working'),
    member('reviewer', 'root', 'completed'),
    member('broken', 'reviewer', 'failed'),
    member('settled', 'root', 'completed'),
    member('settled-below', 'settled', 'completed'),
  ]);

  expect(fold.standing).toEqual(['lead', 'reviewer']);
  expect(fold.finished).toEqual(['settled']);
});

test('a pinned finished child stands after the live ones and holds its finished parent in view until the pin is released', () => {
  const pinned = (id: string, parent: string): ThreadListRow => ({ ...member(id, parent, 'completed'), pinnedAt: JUST });
  const rows = [
    row('root', 'idle', null),
    member('done-a', 'root', 'completed'),
    pinned('kept', 'root'),
    member('work', 'root', 'working'),
    member('lead', 'root', 'completed'),
    pinned('deep', 'lead'),
    member('done-b', 'root', 'completed'),
  ];
  const forest = new ThreadForest();
  for (const held of rows) forest.put(held);
  const ids = (nodes: readonly ThreadTreeNode[]) => nodes.map((node) => node.row.id);
  const fold = () => foldTeam(forest.roots[0]?.children ?? []);

  expect(ids(fold().standing)).toEqual(['work']);
  expect(ids(fold().pinned)).toEqual(['lead', 'kept']);
  expect(ids(fold().finished)).toEqual(['done-b', 'done-a']);

  forest.put({ ...pinned('deep', 'lead'), pinnedAt: null });
  expect(ids(fold().pinned)).toEqual(['kept']);
  expect(ids(fold().finished)).toEqual(['lead', 'done-b', 'done-a']);
});

test('a working child with a wait below it is never cut behind "more working"', () => {
  const fold = teamFold([
    ...Array.from({ length: 5 }, (_, index) => member(`work-${index}`, 'root', 'working')),
    member('busy-lead', 'root', 'working'),
    member('asker', 'busy-lead', 'awaiting'),
    member('work-5', 'root', 'working'),
  ]);

  expect(fold.standing).toEqual(['work-0', 'work-1', 'work-2', 'work-3', 'work-4', 'busy-lead']);
  expect(fold.moreWorking).toEqual(['work-5']);
});

test('a failed child stops standing and counting once it is seen, runs again or is archived', () => {
  const failed = member('broken', 'root', 'failed');
  expect(teamFold([failed]).standing).toEqual(['broken']);
  expect(teamFold([{ ...failed, archivedAt: JUST }]).finished).toEqual(['broken']);

  const seen = { ...failed, outcome: ended('failed', true, JUST) };
  expect(teamFold([seen]).finished).toEqual(['broken']);
  expect(threadTree([row('root', 'idle', null), seen])[0]?.team).toMatchObject({ failed: 0 });

  const running = { ...row('broken', 'working', 'root'), outcome: failed.outcome };
  const team = threadTree([row('root', 'idle', null), running])[0]?.team;
  expect(team).toMatchObject({ working: 1, failed: 0 });
});

test("a team counts every descendant's work, waits, failures and cuts apart, and names who works in handed order", () => {
  const [root] = threadTree([
    row('root', 'working', null),
    member('lead', 'root', 'working'),
    member('helper', 'lead', 'working'),
    member('asker', 'lead', 'awaiting'),
    member('side', 'root', 'completed'),
    member('deep', 'side', 'working'),
    member('broken', 'side', 'failed'),
    member('stopped', 'side', 'cut'),
  ]);

  expect(root?.team).toMatchObject({ working: 3, asking: 1, failed: 1, cut: 1, workers: ['lead', 'helper', 'deep'] });
  expect(root?.children[1]?.team).toMatchObject({ working: 1, asking: 0, failed: 1, cut: 1, workers: ['deep'] });
  expect(root?.children[1]?.children[0]?.team).toMatchObject({ working: 0, asking: 0, failed: 0, cut: 0, workers: [] });
});

test('a cut child is no failure in its team, yet still keeps its parent standing', () => {
  const [root] = threadTree([row('root', 'idle', null), member('side', 'root', 'completed'), member('stopped', 'side', 'cut')]);
  expect(root?.team).toMatchObject({ failed: 0, cut: 1 });
  expect(teamFold([member('side', 'root', 'completed'), member('stopped', 'side', 'cut')]).standing).toContain('side');
});

test('the next waiting thread is the first one drawn below the focused row, wrapping at the end', () => {
  const done = (id: string, parent: string): ThreadListRow => ({
    ...row(id, 'idle', parent),
    outcome: ended('completed', true, '2026-01-01T01:00:00.000Z'),
  });
  const trees = bandedTree([
    row('asker', 'awaiting', null),
    row('team', 'working', null),
    done('finished', 'team'),
    row('lead', 'working', 'team'),
    row('deep', 'awaiting', 'lead'),
    row('quiet', 'idle', null),
  ]);
  const next = (from: string | null) =>
    nextWaiting(trees, from)
      ?.map((node) => node.row.id)
      .join('>');

  expect(next(null)).toBe('asker');
  expect(next('team')).toBe('team>lead>deep');
  expect(next('finished')).toBe('asker');
  expect(next('asker')).toBe('team>lead>deep');
  expect(next('deep')).toBe('asker');
  expect(next('quiet')).toBe('asker');
});

test("a row's own run never colours its own chevron", () => {
  const answer = lifeBelow([row('root', 'working', null), row('child', 'idle', 'root'), row('waiting-alone', 'awaiting', null)]);

  expect(answer).toEqual({ root: 'idle', child: 'idle', 'waiting-alone': 'idle' });
});

const drawn = (rows: readonly ThreadListRow[]): readonly string[] => bandedTree(rows).map((node) => node.row.id);

test('a pinned tree stands above every unpinned one, including a live one', () => {
  const pinned = row('pinned', 'idle', null, {
    readerOrderAt: '2026-01-01T08:00:00.000Z',
    pinnedAt: '2026-01-01T09:00:00.000Z',
  });
  const working = row('working', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    readerOrderAt: '2026-01-01T10:00:00.000Z',
  });
  const fresh = row('fresh', 'idle', null, { readerOrderAt: '2026-01-01T13:00:00.000Z' });

  expect(drawn([fresh, working, pinned])).toEqual(['pinned', 'working', 'fresh']);
});

test('inside the band life and the reader clock order the rows, and pin age orders nothing', () => {
  const first = row('first', 'idle', null, {
    readerOrderAt: '2026-01-01T01:00:00.000Z',
    pinnedAt: '2026-01-01T09:00:00.000Z',
  });
  const second = row('second', 'idle', null, {
    readerOrderAt: '2026-01-01T20:00:00.000Z',
    pinnedAt: '2026-01-01T10:00:00.000Z',
  });
  const third = row('third', 'working', null, {
    runStartedAt: '2026-01-01T05:00:00.000Z',
    readerOrderAt: '2026-01-01T15:00:00.000Z',
    pinnedAt: '2026-01-01T11:00:00.000Z',
  });

  expect(drawn([second, third, first])).toEqual(['third', 'second', 'first']);
});

test('a pinned tree that wakes climbs inside its band and falls back when it goes quiet', () => {
  const held = row('held', 'idle', null, {
    readerOrderAt: '2026-01-01T02:00:00.000Z',
    pinnedAt: '2026-01-01T12:00:00.000Z',
  });
  const above = row('above', 'idle', null, {
    readerOrderAt: '2026-01-01T18:00:00.000Z',
    pinnedAt: '2026-01-01T08:00:00.000Z',
  });
  const unpinned = row('unpinned', 'working', null, { runStartedAt: '2026-01-01T09:00:00.000Z' });

  expect(drawn([above, held, unpinned])).toEqual(['above', 'held', 'unpinned']);

  const woken = row('held', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    readerOrderAt: '2026-01-01T02:00:00.000Z',
    pinnedAt: '2026-01-01T12:00:00.000Z',
  });

  expect(drawn([above, woken, unpinned])).toEqual(['held', 'above', 'unpinned']);
});

test('releasing a pin gives back the place the bands below it had all along', () => {
  const watched = row('watched', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const helper = row('helper', 'working', 'watched', { runStartedAt: '2026-01-01T10:00:00.000Z' });
  const quiet = row('quiet', 'idle', null, { readerOrderAt: '2026-01-01T13:00:00.000Z' });
  const held = { ...quiet, pinnedAt: '2026-01-01T09:30:00.000Z' };

  expect(drawn([watched, helper, held])).toEqual(['quiet', 'watched']);
  expect(drawn([watched, helper, quiet])).toEqual(['watched', 'quiet']);
});

const column = (rows: readonly ThreadListRow[], pinnedOpen = true): readonly string[] =>
  columnEntries(bandedTree(rows), pinnedOpen).map((entry) =>
    entry.kind === 'root'
      ? entry.node.row.id
      : entry.kind === 'line'
        ? '—'
        : entry.kind === 'pinned'
          ? `pinned:${entry.count}`
          : `folder:${entry.folder.name}`,
  );

test('only the pinned band takes a header; every other band change is the hairline', () => {
  const held = row('held', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z', pinnedAt: '2026-01-01T09:00:00.000Z' });
  const busy = row('busy', 'working', null, { runStartedAt: '2026-01-01T10:00:00.000Z' });
  const quiet = row('quiet', 'idle', null, { readerOrderAt: '2026-01-01T08:00:00.000Z' });

  expect(column([held, busy, quiet])).toEqual(['pinned:1', 'held', '—', 'busy', '—', 'quiet']);
  expect(column([busy, quiet])).toEqual(['busy', '—', 'quiet']);
});

test('a folded pinned band draws its live trees alone, and its header still counts the held', () => {
  const working = row('working', 'working', null, {
    runStartedAt: '2026-01-01T10:00:00.000Z',
    pinnedAt: '2026-01-01T07:00:00.000Z',
  });
  const first = row('first', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z', pinnedAt: '2026-01-01T08:00:00.000Z' });
  const second = row('second', 'idle', null, { readerOrderAt: '2026-01-01T08:00:00.000Z', pinnedAt: '2026-01-01T09:00:00.000Z' });
  const loose = row('loose', 'idle', null, { readerOrderAt: '2026-01-01T07:00:00.000Z' });

  expect(column([first, second, working, loose], false)).toEqual(['pinned:3', 'working', '—', 'loose']);
  expect(column([first, second, loose], false)).toEqual(['pinned:2', '—', 'loose']);
});

const shelfColumn = (rows: readonly ThreadListRow[], closed: readonly string[] = [], keepId: string | null = null): readonly string[] =>
  columnEntries(bandedTree(rows), true, {
    folders: [
      { id: 'waves', name: 'Waves', position: 0, parentId: null },
      { id: 'research', name: 'Research', position: 1, parentId: null },
    ],
    isOpen: (id) => !closed.includes(id),
    keepId,
    filtering: false,
  }).flatMap((entry) =>
    entry.kind === 'folder'
      ? [`folder:${entry.folder.name}:${entry.trees.length}`, ...entry.drawn.map((node) => `  ${node.row.id}`)]
      : [entry.kind === 'root' ? entry.node.row.id : entry.kind === 'line' ? '—' : `pinned:${entry.count}`],
  );

test('folders stand between the live and the quiet loose trees; a pinned tree stands pinned and a tree of an unknown folder stands loose', () => {
  const busy = row('busy', 'working', null, { runStartedAt: '2026-01-01T10:00:00.000Z' });
  const filed = { ...row('filed', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' }), folderId: 'waves' };
  const working = { ...row('working', 'working', null, { runStartedAt: '2026-01-01T11:00:00.000Z' }), folderId: 'waves' };
  const held = { ...row('held', 'idle', null, { pinnedAt: '2026-01-01T08:00:00.000Z' }), folderId: 'research' };
  const stray = { ...row('stray', 'idle', null, { readerOrderAt: '2026-01-01T07:00:00.000Z' }), folderId: 'gone' };

  expect(shelfColumn([busy, filed, working, held, stray])).toEqual([
    'pinned:1',
    'held',
    '—',
    'busy',
    '—',
    'folder:Waves:2',
    '  working',
    '  filed',
    'folder:Research:0',
    '—',
    'stray',
  ]);
});

test('a folded folder counts its trees and draws only the tree that holds the open thread', () => {
  const lead = { ...row('lead', 'idle', null, { readerOrderAt: '2026-01-01T09:00:00.000Z' }), folderId: 'waves' };
  const helper = row('helper', 'awaiting', 'lead');
  const other = { ...row('other', 'idle', null, { readerOrderAt: '2026-01-01T08:00:00.000Z' }), folderId: 'waves' };
  const entries = columnEntries(bandedTree([lead, helper, other]), true, {
    folders: [{ id: 'waves', name: 'Waves', position: 0, parentId: null }],
    isOpen: () => false,
    keepId: 'helper',
    filtering: false,
  });
  const folder = entries.find((entry) => entry.kind === 'folder');

  expect(folder?.kind === 'folder' && folder.drawn.map((node) => node.row.id)).toEqual(['lead']);
  expect(folder?.kind === 'folder' && folder.team.asking).toBe(1);
  expect(shelfColumn([lead, helper, other], ['waves'])).toEqual(['folder:Waves:2', 'folder:Research:0']);
});

test('a subfolder counts into its parent; a folded parent draws only the chain to the open thread; filtering hides folders without a hit', () => {
  const lead = { ...row('lead', 'awaiting', null), folderId: 'inner' };
  const other = { ...row('other', 'idle', null, { readerOrderAt: '2026-01-01T08:00:00.000Z' }), folderId: 'outer' };
  const folders = [
    { id: 'outer', name: 'Outer', position: 0, parentId: null },
    { id: 'inner', name: 'Inner', position: 0, parentId: 'outer' },
    { id: 'empty', name: 'Empty', position: 1, parentId: 'outer' },
  ];
  const roots = bandedTree([lead, other]);
  const shelf = (isOpen: boolean, keepId: string | null, filtering = false) => {
    const outer = columnEntries(roots, true, { folders, isOpen: () => isOpen, keepId, filtering }).find((entry) => entry.kind === 'folder');
    if (outer?.kind !== 'folder') throw new Error('no folder entry');
    return outer;
  };

  const open = shelf(true, null);
  expect(open.trees.map((node) => node.row.id).sort()).toEqual(['lead', 'other']);
  expect(open.team.asking).toBe(1);
  expect(open.folders.map((entry) => [entry.folder.id, entry.depth])).toEqual([
    ['inner', 1],
    ['empty', 1],
  ]);

  const folded = shelf(false, 'lead');
  expect(folded.drawn).toEqual([]);
  expect(folded.folders.map((entry) => entry.folder.id)).toEqual(['inner']);
  expect(folded.folders[0]?.drawn.map((node) => node.row.id)).toEqual(['lead']);

  expect(shelf(false, null).folders).toEqual([]);
  expect(shelf(true, null, true).folders.map((entry) => entry.folder.id)).toEqual(['inner']);
});

const harnessRow = (
  id: string,
  work: 'working' | 'waiting' | 'idle' | 'unknown',
  clocks: { readerOrderAt?: string; spellStartedAt?: string } = {},
): ThreadListRow => ({
  ...row(id, work === 'working' ? 'working' : work === 'waiting' ? 'awaiting' : 'idle', null, clocks),
  agentId: 'harness',
  liveSpellStartedAt: clocks.spellStartedAt ?? '2026-01-01T10:00:00.000Z',
  harness: {
    name: 'cursor',
    provider: 'external',
    transport: 'terminal',
    agent: null,
    capabilities: TERMINAL,
    model: work === 'working' ? 'sonnet' : null,
    effort: null,
    asked: null,
    execution: { execution: 'e-1', incarnation: 1 },
    process: { id: 's-1', state: 'running', startedAt: '2026-01-01T09:00:00.000Z' },
    observation: {
      binding: { sessionId: 's-1', execution: { execution: 'e-1', incarnation: 1 }, rootKey: 'root-1' },
      revision: 1,
      metadata: {
        model: { _tag: 'NotRead' },
        effort: { _tag: 'NotRead' },
        title: { _tag: 'NotRead' },
      },
      diagnostics: [],
    },
  },
});

test('a harness bands live on confirmed work or a wait, quiet on idle or unmeasured', () => {
  const quiet = row('quiet', 'idle', null, { readerOrderAt: '2026-01-01T13:00:00.000Z' });
  const working = harnessRow('working', 'working', { readerOrderAt: '2026-01-01T09:00:00.000Z' });
  const waiting = harnessRow('waiting', 'waiting', { readerOrderAt: '2026-01-01T08:00:00.000Z' });
  const idle = harnessRow('idle', 'idle', { readerOrderAt: '2026-01-01T12:00:00.000Z' });
  const unknown = harnessRow('unknown', 'unknown', { readerOrderAt: '2026-01-01T11:00:00.000Z' });

  expect(banded([quiet, idle, unknown, working, waiting])).toEqual(['working', 'waiting', 'quiet', 'idle', 'unknown']);
});
