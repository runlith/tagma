import { expect, test } from 'bun:test';
import { factsOf } from './identity.js';

const row = {
  id: 'thread-a',
  projectId: null,
  parentId: null,
  spawnRootId: 'thread-a',
  detachedFrom: null,
  detachedAt: null,
  principalId: 'owner',
  name: null,
  title: 'New thread',
  titleOrigin: 'random' as const,
  titleAskedInput: null,
  titleRevision: 0,
  harness: null,
  agentId: 'tagma',
  bornOf: null,
  spawnedByRunId: null,
  createdBy: null,
  scopeBlockUuid: null,
  createdBySessionId: null,
  readerOrderAt: new Date(1_000),
  pinnedAt: null,
  folderId: null,
  archivedAt: null,
  status: 'idle' as const,
  runningRunId: null,
  movedAt: null,
  recap: null,
  createdAt: new Date(1_000),
};

test('a record with no project reads as unscoped, and its stored tagma harness as native', () => {
  expect(factsOf(row)).toMatchObject({
    origin: 'unscoped',
    projectId: null,
    harness: 'tagma',
    title: 'New thread',
    titleProvenance: 'random',
    titleRevision: 0,
    readerOrderAt: new Date(1_000),
  });
});

test('a facet supplies the project, the title and the harness it names', () => {
  const facts = factsOf({
    ...row,
    projectId: 7,
    title: 'named',
    titleOrigin: 'harness',
    titleRevision: 3,
    harness: 'claude-code',
    readerOrderAt: new Date(2_000),
  });
  expect(facts).toMatchObject({
    origin: 'scoped',
    projectId: 7,
    title: 'named',
    titleProvenance: 'harness',
    titleRevision: 3,
    harness: 'claude-code',
    readerOrderAt: new Date(2_000),
  });
});
