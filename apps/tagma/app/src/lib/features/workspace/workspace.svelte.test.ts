// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { makePlatform, makeRefusingStorage, makeRouter, makeRouterWithLog, makeStorage } from '@runlith/layer/testing';
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
          ...makeStorage({ 'tagma.lastProjectId': '1' }),
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
  workspace.remember(projects[1]!);
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

test.each([
  [
    '/first/graph/alpha?branch=feature',
    '/[project]/graph/[[id]]',
    { project: 'first', id: 'alpha' },
    '/renamed/graph/alpha?branch=feature',
  ],
  ['/settings?project=first&section=graph', '/settings', {}, '/settings?project=renamed&section=graph'],
] as const)('a window standing at %s moves to the new name when the registry renames its project', async (at, routeId, params, moved) => {
  const { router, visited } = makeRouterWithLog({ url: new URL(at, 'http://localhost'), routeId, params: { ...params } });
  const renamed = projects.map((project) => (project.id === 1 ? { ...project, name: 'renamed' } : project));
  const workspace = new Workspace(
    { list: stubSingle({ loadOrThrow: async () => projects, refresh: async () => renamed }) } as never,
    router,
    makePlatform({ local: makeStorage() }),
    new Failure((error) => {
      throw error;
    }),
  );
  await waitUntil(() => workspace.loaded);
  await workspace.refreshProjects();
  expect(visited).toEqual([{ href: moved, replaced: true }]);
});

test('a rename told while an older registry read is still in flight is followed once a read made after the news lands', async () => {
  const { router, visited } = makeRouterWithLog({
    url: new URL('/first/graph', 'http://localhost'),
    routeId: '/[project]/graph/[[id]]',
    params: { project: 'first' },
  });
  const older = Promise.withResolvers<readonly Project[]>();
  const answers = [
    older.promise,
    Promise.resolve(projects.map((project) => (project.id === 1 ? { ...project, name: 'renamed' } : project))),
  ];
  const workspace = new Workspace(
    { list: stubSingle({ loadOrThrow: async () => projects, refresh: () => answers.shift()! }) } as never,
    router,
    makePlatform({ local: makeStorage() }),
    new Failure((error) => {
      throw error;
    }),
  );
  await waitUntil(() => workspace.loaded);
  const reading = workspace.refreshProjects();
  const told = workspace.refreshProjects();
  older.resolve(projects);
  await Promise.all([reading, told]);
  expect(visited).toEqual([{ href: '/renamed/graph', replaced: true }]);
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
