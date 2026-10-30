// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { makePlatform, makeRefusingStorage, makeRouter, makeRouterWithLog, makeStorage } from '@runlith/layer/testing';
import { stubSingle } from '@runlith/query/testing';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Workspace } from './Selection.svelte.js';

const groups = () => stubSingle({ loadOrThrow: async () => [], refresh: async () => [] });

const projects = ['first', 'second'].map((name, i): Project => ({
  id: i + 1,
  name,
  repoKey: name,
  rootPath: `/projects/${name}`,
  strictProvenance: false,
  private: false,
  kind: 'folder',
  storage: 'stealth',
  graphRemote: null,
  servesFrom: 'rows',
  createdAt: '2026-09-05T00:00:00Z',
}));

test('a member of a group stands under the group’s tile, and a thread row carries a mark for every home but the first member, wherever the window stands; a project in no group marks only foreign homes', async () => {
  const shop: Project = { ...projects[0]!, id: 9, name: 'shop', repoKey: 'group:shop', kind: 'group' };
  const third: Project = { ...projects[0]!, id: 3, name: 'third', repoKey: 'third', rootPath: '/projects/third' };
  const workspace = new Workspace(
    {
      list: stubSingle({ loadOrThrow: async () => [...projects, third, shop] }),
      groups: stubSingle({ loadOrThrow: async () => [{ graph: shop, members: [projects[1]!, projects[0]!] }] }),
    } as never,
    makeRouter({ params: { project: 'first' } }),
    makePlatform({ local: makeStorage() }),
    new Failure((error) => {
      throw error;
    }),
  );
  await waitUntil(() => workspace.loaded);
  expect(workspace.contextTile?.name).toBe('shop');
  expect([workspace.tileIdOf(1), workspace.tileIdOf(2), workspace.tileIdOf(3)]).toEqual([9, 9, 3]);
  expect([1, 2].map((standing) => [workspace.markOf(1, standing), workspace.markOf(2, standing)])).toEqual([
    [1, null],
    [1, null],
  ]);
  expect([workspace.markOf(3, 3), workspace.markOf(1, 3)]).toEqual([null, 1]);
});

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
    { list: stubSingle({ loadOrThrow: async () => projects }), groups: groups() } as never,
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
  const global: Project = { ...projects[0]!, name: 'global', kind: 'global' };
  const opened = (entry?: { readonly project: string }) =>
    new Workspace(
      { list: stubSingle({ loadOrThrow: async () => [global] }), groups: groups() } as never,
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
    { list: stubSingle({ loadOrThrow: async () => projects, refresh: async () => renamed }), groups: groups() } as never,
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

test.each([
  ['/first/graph', '/renamed/graph', '/[project]/graph/[[id]]'],
  ['/settings?project=first', '/settings?project=renamed', '/settings'],
] as const)('a window at %s keeps the project the registry renames until its address catches up', async (at, moved, routeId) => {
  let url = $state(new URL(at, 'http://localhost'));
  const landing = Promise.withResolvers<void>();
  const router = makeRouter({
    url: () => url,
    routeId,
    get params(): Record<string, string> {
      return routeId === '/settings' ? {} : { project: url.pathname.split('/')[1] ?? '' };
    },
    goto: () => landing.promise,
  });
  const standing = () => workspace.named(router.params.project ?? router.url.searchParams.get('project'));
  const workspace = new Workspace(
    {
      list: stubSingle({
        loadOrThrow: async () => projects,
        refresh: async () => projects.map((project) => (project.id === 1 ? { ...project, name: 'renamed' } : project)),
      }),
      groups: groups(),
    } as never,
    router,
    makePlatform({ local: makeStorage() }),
    new Failure((error) => {
      throw error;
    }),
  );
  await waitUntil(() => workspace.loaded);

  await workspace.refreshProjects();
  expect(standing()?.id).toBe(1);

  url = new URL(moved, 'http://localhost');
  landing.resolve();
  await landing.promise;
  expect(standing()?.name).toBe('renamed');
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
    { list: stubSingle({ loadOrThrow: async () => projects, refresh: () => answers.shift()! }), groups: groups() } as never,
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
      groups: groups(),
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
