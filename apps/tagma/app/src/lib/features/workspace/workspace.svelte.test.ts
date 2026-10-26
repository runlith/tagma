// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { makePlatform, makeRefusingStorage, makeRouter, makeStorage } from '@runlith/layer/testing';
import { stubSingle } from '@runlith/query/testing';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Workspace } from './Selection.svelte.js';

const projects = ['first', 'second'].map((name, i): Project => ({
  id: i + 1,
  name,
  repoKey: name,
  rootPath: `/projects/${name}`,
  strictProvenance: false,
  private: false,
  global: false,
  storage: 'stealth',
  graphRemote: null,
  servesFrom: 'rows',
  createdAt: '2026-09-05T00:00:00Z',
}));

test.each(['refused', 'older'] as const)('the remembered project survives %s storage in this document', async (mode) => {
  const local =
    mode === 'refused'
      ? makeRefusingStorage()
      : {
          ...makeStorage({ 'tagma.lastProject': 'first' }),
          setItem: () => undefined,
        };
  const route = { params: { project: 'second' } as Record<string, string> };
  const failure = new Failure((error) => {
    throw error;
  });
  const workspace = new Workspace(
    { list: stubSingle({ loadOrThrow: async () => projects }) } as never,
    makeRouter(route),
    makePlatform({ local }),
    failure,
  );
  await waitUntil(() => workspace.loaded);
  expect(workspace.contextProject?.name).toBe('second');
  workspace.remember('second');
  route.params = {};
  expect(workspace.contextProject?.name).toBe('second');
  expect(workspace.entryProject()?.name).toBe('second');
  route.params = { project: 'first' };
  expect(workspace.contextProject?.name).toBe('first');
});

test('the project the composition names is resumed even when only global projects stand; without one such a window resumes nothing', async () => {
  const global: Project = { ...projects[0]!, name: 'global', global: true };
  const opened = (entry?: { readonly project: string }) =>
    new Workspace(
      { list: stubSingle({ loadOrThrow: async () => [global] }) } as never,
      makeRouter({ params: {} }),
      makePlatform({ local: makeStorage() }),
      new Failure((error) => {
        throw error;
      }),
      entry,
    );
  const named = opened({ project: 'global' });
  const bare = opened();
  await waitUntil(() => named.loaded && bare.loaded);
  expect(named.resumed()?.name).toBe('global');
  expect(bare.resumed()).toBeNull();
});

test('a project registered after the registry was read is found by one re-read, however many readers ask for it', async () => {
  const later: Project = { ...projects[0]!, id: 3, name: 'polygon', repoKey: 'polygon', rootPath: '/projects/polygon' };
  let reads = 0;
  const workspace = new Workspace(
    {
      list: stubSingle({
        loadOrThrow: async () => projects,
        refresh: async () => {
          reads += 1;
          return [...projects, later];
        },
      }),
    } as never,
    makeRouter({ params: {} }),
    makePlatform({ local: makeStorage() }),
    new Failure((error) => {
      throw error;
    }),
  );
  await waitUntil(() => workspace.loaded);

  expect(workspace.find(3)).toBeNull();
  expect(workspace.find(3)).toBeNull();
  await waitUntil(() => workspace.find(3)?.name === 'polygon');
  expect(workspace.find(1)?.name).toBe('first');
  expect(reads).toBe(1);
});
