import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadFolds } from './threadFolds.svelte.js';
import { threadTree } from './forest.js';

const row = (id: string, parentThreadId: string | null): ThreadListRow => ({
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
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  account: null,
  provider: 'anthropic',
  model: null,
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: '2026-01-01T00:00:00.000Z',
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const folds = (storage = makeStorage(), projectId = 1) => new ThreadFolds({ projectId }, new ReaderMarks(storage));

test('collapse closes every spawn parent and puts back only the parents it closed', () => {
  const trees = threadTree([
    row('root', null),
    row('middle', 'root'),
    row('leaf', 'middle'),
    row('hand-folded', null),
    row('hand-folded-child', 'hand-folded'),
  ]);
  const state = folds();
  state.toggle('hand-folded');

  state.closeAll(trees);

  expect(state.isOpen('root')).toBe(false);
  expect(state.isOpen('middle')).toBe(false);
  expect(state.isOpen('hand-folded')).toBe(false);
  expect(state.anyOpen(trees)).toBe(false);
  expect(state.canOpenBack).toBe(true);

  state.openBack();

  expect(state.isOpen('root')).toBe(true);
  expect(state.isOpen('middle')).toBe(true);
  expect(state.isOpen('hand-folded')).toBe(false);
  expect(state.anyOpen(trees)).toBe(true);
  expect(state.canOpenBack).toBe(false);
});

test('a stub starts closed, collapse closes an opened one, and putting the trees back leaves it closed', () => {
  const trees = threadTree([row('root', null), row('child', 'root')]);
  const state = folds();
  expect(state.isStubOpen('root')).toBe(false);

  state.toggleStub('root');
  expect(state.isStubOpen('root')).toBe(true);

  state.closeAll(trees);
  expect(state.isStubOpen('root')).toBe(false);

  state.openBack();
  expect(state.isOpen('root')).toBe(true);
  expect(state.isStubOpen('root')).toBe(false);
});

test('"more working" opens for the tab alone, and collapse closes it', () => {
  const storage = makeStorage();
  const trees = threadTree([row('root', null), row('child', 'root')]);
  const state = folds(storage);
  expect(state.isMoreOpen('root')).toBe(false);

  state.toggleMore('root');
  expect(state.isMoreOpen('root')).toBe(true);
  expect(folds(storage).isMoreOpen('root')).toBe(false);

  state.closeAll(trees);
  expect(state.isMoreOpen('root')).toBe(false);
});

test('the pinned band folds by its own chevron alone; the collapse press does not see it', () => {
  const trees = threadTree([row('root', null), row('child', 'root')]);
  const state = folds();
  expect(state.isPinnedOpen()).toBe(true);

  state.togglePinned();
  expect(state.isPinnedOpen()).toBe(false);
  state.togglePinned();
  expect(state.isPinnedOpen()).toBe(true);

  state.closeAll(trees);
  expect(state.isPinnedOpen()).toBe(true);
  state.openBack();
  expect(state.isPinnedOpen()).toBe(true);
});

test('the folds the reader left are the folds a reload finds', () => {
  const storage = makeStorage();
  const before = folds(storage);
  before.toggle('root');
  before.toggleStub('root');
  before.togglePinned();

  const after = folds(storage);
  expect(after.isOpen('root')).toBe(false);
  expect(after.isStubOpen('root')).toBe(true);
  expect(after.isOpen('other')).toBe(true);
  expect(after.isPinnedOpen()).toBe(false);
});

test('a collapse survives the reload but its put-back receipt does not', () => {
  const storage = makeStorage();
  const trees = threadTree([row('root', null), row('child', 'root')]);
  const before = folds(storage);
  before.closeAll(trees);
  expect(before.canOpenBack).toBe(true);

  const after = folds(storage);
  expect(after.isOpen('root')).toBe(false);
  expect(after.anyOpen(trees)).toBe(false);
  expect(after.canOpenBack).toBe(false);
});

test("a fold is the project's own: another graph reads nothing of it", () => {
  const storage = makeStorage();
  folds(storage, 1).toggle('root');

  const other = folds(storage, 2);
  expect(other.isOpen('root')).toBe(true);
  expect(other.isStubOpen('root')).toBe(false);
});
