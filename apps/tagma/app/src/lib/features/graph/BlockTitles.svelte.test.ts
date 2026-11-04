// @vitest-environment jsdom
import { Scope } from '@runlith/layer/Scope';
import { Failure } from '@runlith/layer/Failure';
import { makeRouter, makeRouterWithLog } from '@runlith/layer/testing';
import { single } from '@runlith/query/builders/single';
import { keyed } from '@runlith/query/builders/keyed';
import { QueryClient } from '@tanstack/query-core';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { OperationAnswer } from '$lib/wire/operation.js';
import type { GraphFrame } from '$lib/wire/Live.js';
import type { Project, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { GraphAim } from '$lib/features/workspace/GraphRung.js';
import { Refusal } from '$lib/wire/refusal.js';
import { readyState, testAddresses } from '$lib/app/testing.js';
import { BlockTitles } from './BlockTitles.svelte.js';
import { blockRefView, type BlockRefPeer } from './blockRefView.js';

type Titles = OperationAnswer<'read_titles'>;
const name = '1234abcd';
const identity = '0000000000000000000000001234abcd';
const found: Titles = {
  status: 'ok',
  titles: [{ name, shortName: name, identity, title: 'Resolved block', projectId: 2, branch: 'feature' }],
  unreadable: [],
};
const scopes: Scope[] = [];
const caches: QueryClient[] = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close();
  for (const cache of caches.splice(0)) cache.clear();
});

const registered: readonly Project[] = ['home', 'other'].map((name, index) => ({
  id: index + 1,
  name,
  repoKey: name,
  rootPath: `/${name}`,
  strictProvenance: true,
  private: false,
  kind: 'folder',
  storage: 'team',
  servesFrom: 'files',
  createdAt: '2026-10-10T00:00:00Z',
}));

function open(
  load: (names: readonly string[], signal: AbortSignal) => Promise<Titles>,
  aim: GraphAim = { projectId: 1, branch: null },
  readProjects: (signal: AbortSignal) => Promise<readonly Project[]> = async () => registered,
) {
  const scope = Scope.make();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  scopes.push(scope);
  caches.push(cache);
  const family = keyed<readonly string[], Titles>({
    name: 'titles',
    scope,
    queryClient: cache,
    loader: ({ key, signal }) => load(key, signal),
  });
  let receive: (frame: GraphFrame) => void = () => undefined;
  const feed = {
    frames: (listener: (frame: GraphFrame) => void) => {
      receive = listener;
      return () => {
        receive = () => undefined;
      };
    },
  };
  const workspace = new Workspace(
    {
      list: single({ name: 'projects', scope, queryClient: cache, loader: ({ signal }) => readProjects(signal) }),
      groups: single({ name: 'groups', scope, queryClient: cache, loader: async () => [] }),
    } as never,
    makeRouter(),
    readyState(),
    new Failure((cause) => {
      throw cause;
    }),
  );
  const at = { url: new URL('http://localhost/home/chat') };
  const { router, visited } = makeRouterWithLog({ url: () => at.url });
  const titles = new BlockTitles({ titles: family } as never, feed as never, workspace, aim, router, testAddresses(router), scope);
  return { titles, family, workspace, scope, visited, at, send: (frame: GraphFrame) => receive(frame) };
}

function failure(peer: BlockRefPeer): Refusal | undefined {
  return peer != null && 'error' in peer ? peer.error : undefined;
}

test.each(['ambiguous-name', 'graph-pool'])('a %s refusal remains a typed reading result until an explicit new read', async (code) => {
  const refusal = new Refusal({ gate: true, code, reason: 'Cannot resolve this address', unblock: ['Read a complete address'] });
  let answer: Titles | Refusal = refusal;
  const { titles, family } = open(async () => {
    if (answer instanceof Refusal) throw answer;
    return answer;
  });
  const seen: BlockRefPeer[] = [];
  const dispose = $effect.root(() => {
    $effect(() => {
      seen.push(titles.peer(name));
    });
  });
  try {
    flushSync();
    expect(seen.at(-1)).toBeUndefined();
    await titles.copy(name);
    flushSync();
    expect(failure(seen.at(-1))).toBe(refusal);
    expect(family.key([name]).watchError()).toBe(refusal);
    expect(blockRefView(testAddresses(), name, null, titles.peer(name))).toMatchObject({ text: name, title: refusal.message, dead: false });
    answer = found;
    expect(failure(titles.peer(name))).toBe(refusal);
    await titles.refresh(name);
    flushSync();
    expect(seen.at(-1)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
    expect(family.key([name]).watchError()).toBeUndefined();
    answer = { status: 'ok', titles: [], unreadable: [] };
    await titles.refresh(name);
    expect(titles.peer(name)).toBeNull();
    expect(blockRefView(testAddresses(), name, null, titles.peer(name)).dead).toBe(true);
  } finally {
    dispose();
  }
});

test('an unreadable copy leaves resolved foreign links open and unresolved names refused', async () => {
  const missing = 'abcd1234';
  const error = { code: 'graph-unmerged', reason: 'The other copy has an unfinished merge', unblock: ['Finish its merge'] };
  const { titles } = open(async () => ({
    ...found,
    unreadable: [{ projectId: 1, checkout: '/home/branch', branch: 'broken', names: [name, missing], error }],
  }));
  await titles.refresh(name);
  await titles.refresh(missing);
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
  expect(blockRefView(testAddresses(), name, null, titles.peer(name)).href).toBe('/other/b/1234abcd?branch=feature');
  expect(failure(titles.peer(missing))).toMatchObject(error);
});

test('an address opened before its reading answers goes to the project the reading names, and a refused one goes nowhere', async () => {
  const answer = Promise.withResolvers<Titles>();
  const refused = 'abcd1234';
  const { titles, visited } = open(async (names) => {
    if (names.includes(refused)) throw new Refusal({ gate: true, code: 'ambiguous-name', reason: 'Two blocks', unblock: ['Read more'] });
    return answer.promise;
  });
  expect(blockRefView(testAddresses(), name, null, titles.peer(name)).href).toBeNull();
  const opening = titles.open(name);
  answer.resolve(found);
  await opening;
  expect(visited).toEqual([{ href: '/other/b/1234abcd?branch=feature', replaced: false }]);
  await titles.open(refused);
  expect(visited).toHaveLength(1);
});

test('an opening whose page the operator left before the reading answered navigates nowhere', async () => {
  const answer = Promise.withResolvers<Titles>();
  const { titles, visited, at } = open(() => answer.promise);
  const opening = titles.open(name);
  at.url = new URL('http://localhost/home/chat/elsewhere');
  answer.resolve(found);
  await opening;
  expect(visited).toEqual([]);
});

test('a renewed single address is not overwritten by a late refusal of an earlier batch', async () => {
  const batch = Promise.withResolvers<Titles>();
  const started = Promise.withResolvers<void>();
  const refusal = new Refusal({ gate: true, code: 'ambiguous-name', reason: 'Batch could not resolve', unblock: ['Read again'] });
  const other = 'abcd1234';
  const { titles } = open(async (names) => {
    if (names.length === 1) return found;
    started.resolve();
    return batch.promise;
  });
  titles.peer(name);
  titles.peer(other);
  await started.promise;
  await titles.refresh(name);
  batch.reject(refusal);
  await titles.copy(other);
  expect(failure(titles.peer(other))).toBe(refusal);
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
});

test('resync abandons the prior generation of title reading before another read starts', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  let fresh = false;
  const { titles, send } = open((_names, signal) => {
    if (fresh) return Promise.resolve(found);
    started.resolve(signal);
    return new Promise<Titles>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const reading = titles.refresh(name);
  const signal = await started.promise;
  fresh = true;
  send({ type: 'resync' });
  expect(titles.peer(name)).toBeUndefined();
  await reading;
  await titles.copy(name);
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
  expect(signal.aborted).toBe(true);
});

test('a resync keeps a shown title until its fresh reading answers, and its reader and address take the fresh one', async () => {
  let answer = Promise.resolve(found);
  const { titles, send } = open(() => answer);
  await titles.refresh(name);
  const later = Promise.withResolvers<Titles>();
  answer = later.promise;
  const seen: BlockRefPeer[] = [];
  const dispose = $effect.root(() => {
    $effect(() => {
      seen.push(titles.peer(name));
    });
  });
  const titleOf = (peer: BlockRefPeer): string | undefined => (peer != null && !('error' in peer) ? peer.title : undefined);
  try {
    flushSync();
    send({ type: 'resync' });
    flushSync();
    later.resolve({
      status: 'ok',
      titles: [{ name, shortName: name, identity, title: 'Retitled block', projectId: 1, branch: null }],
      unreadable: [],
    });
    await waitUntil(() => {
      flushSync();
      return titleOf(seen.at(-1)) === 'Retitled block';
    });
    expect(seen.map(titleOf)).not.toContain(undefined);
    const moved = Promise.withResolvers<Titles>();
    answer = moved.promise;
    send({ type: 'resync' });
    flushSync();
    const copied = titles.copy(name);
    moved.resolve(found);
    expect(await copied).toEqual({ projectId: 2, branch: 'feature' });
  } finally {
    dispose();
  }
});

const row: TreeBlock = {
  name,
  identity,
  rowKey: 1,
  projectId: 1,
  parentName: null,
  parentIdentity: null,
  ord: 0,
  tags: [],
  fields: {},
  actions: { moves: [], slots: [], offers: [], revision: 'test' },
  title: 'Renamed block',
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
};

const change = (block: TreeBlock): GraphFrame => ({
  type: 'change',
  projectId: 1,
  events: [],
  sessions: [],
  blocks: [block],
  edges: [],
  refs: [],
  ready: [],
  readyIdentities: [],
  trash: [],
});

test('branch-local title rows without a branch follow rename and deletion in their live feed', async () => {
  const { titles, send } = open(
    async () => ({ status: 'ok', titles: [{ name, shortName: name, identity, title: 'Before', projectId: 1 }], unreadable: [] }),
    {
      projectId: 1,
      branch: 'feature',
    },
  );
  await titles.refresh(name);
  send(change(row));
  expect(titles.peer(name)).toEqual({ title: 'Renamed block', project: 'home', branch: 'feature' });
  send(change({ ...row, deletedAt: '2026-10-10T01:00:00Z' }));
  expect(titles.peer(name)).toBeNull();
});

test('a local live row does not replace a refused address or a title resolved in another project', async () => {
  const refusal = new Refusal({ gate: true, code: 'ambiguous-name', reason: 'Address collision', unblock: ['Read the complete address'] });
  let answer: Titles | Refusal = refusal;
  const { titles, send } = open(async () => {
    if (answer instanceof Refusal) throw answer;
    return answer;
  });
  await titles.refresh(name);
  send(change(row));
  expect(failure(titles.peer(name))).toBe(refusal);
  answer = found;
  await titles.refresh(name);
  send(change(row));
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
});

test('an intermediate address follows its resolved row title', async () => {
  const identity = '0199000000007000800000001234abcd';
  const partial = identity.slice(-12);
  const { titles, send } = open(async () => ({
    status: 'ok',
    titles: [{ name: partial, shortName: name, identity, rowKey: 1, title: 'Before', projectId: 1, branch: null }],
    unreadable: [],
  }));
  await titles.refresh(partial);
  send(change({ ...row, identity }));
  expect(titles.peer(partial)).toEqual({ title: 'Renamed block', project: 'home', branch: null });
});

test('a new collision invalidates a previously unique intermediate title address', async () => {
  const first = '0199000000007000800000001234abcd';
  const second = '1199000000007000800000001234abcd';
  const partial = first.slice(-12);
  const refusal = new Refusal({ gate: true, code: 'ambiguous-name', reason: 'Two blocks', unblock: ['Read the full identity'] });
  let collision = false;
  const { titles, send } = open(async () => {
    if (collision) throw refusal;
    return {
      status: 'ok',
      titles: [{ name: partial, identity: first, shortName: '1234abcd', rowKey: 1, title: 'Before', projectId: 1, branch: null }],
      unreadable: [],
    };
  });
  await titles.refresh(partial);
  collision = true;
  send(change({ ...row, identity: second, rowKey: 2 }));
  await vi.waitFor(() => expect(failure(titles.peer(partial))).toBe(refusal));
  collision = false;
  send(change({ ...row, identity: second, rowKey: 2, deletedAt: '2026-10-10T01:00:00Z' }));
  await vi.waitFor(() => expect(titles.peer(partial)).toEqual({ title: 'Before', project: 'home', branch: null }));
});

test('a renamed local row refreshes the original full address rather than retargeting it to the trash copy', async () => {
  const original = '0199000000007000800000001234abcd';
  let moved = false;
  const { titles, send } = open(async (names) => ({
    status: 'ok',
    titles: names.map((asked) => ({
      name: asked,
      shortName: name,
      identity: original,
      rowKey: moved ? undefined : 1,
      title: moved ? 'At destination' : 'At source',
      projectId: moved ? 2 : 1,
      branch: null,
    })),
    unreadable: [],
  }));
  await titles.refresh(original);
  expect(titles.peer(original)).toEqual({ title: 'At source', project: 'home', branch: null });
  moved = true;
  send(change({ ...row, name: 'abcdef01', identity: '119900000000700080000000abcdef01', deletedAt: '2026-10-10T01:00:00Z' }));
  await vi.waitFor(() => expect(titles.peer(original)).toEqual({ title: 'At destination', project: 'other', branch: null }));
});

test('a live frame renews a pending address without accepting an older batch result', async () => {
  const batch = Promise.withResolvers<Titles>();
  const started = Promise.withResolvers<void>();
  const { titles, send } = open(async (names) => {
    if (names.length === 1) return found;
    started.resolve();
    return batch.promise;
  });
  titles.peer(name);
  titles.peer('abcd1234');
  await started.promise;
  send(change(row));
  await titles.copy(name);
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
  batch.resolve({ status: 'ok', titles: [{ name, shortName: name, identity, title: 'Older block', projectId: 1 }], unreadable: [] });
  await titles.copy('abcd1234');
  expect(titles.peer('abcd1234')).toBeNull();
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
});

test('a newly registered project is resolved by the workspace before its title becomes a link', async () => {
  let registry: readonly Project[] = registered.slice(0, 1);
  const { titles, workspace } = open(
    async () => found,
    undefined,
    async () => registry,
  );
  await workspace.ready;
  expect(workspace.loaded).toBe(true);
  expect(workspace.projects.map((project) => project.id)).toEqual([1]);
  registry = registered;
  await titles.refresh(name);
  expect(titles.peer(name)).toEqual({ title: 'Resolved block', project: 'other', branch: 'feature' });
  expect(workspace.projects.map((project) => project.id)).toEqual([1, 2]);
});

test('an unresolved project yields a typed refusal rather than a permanently pending link', async () => {
  const { titles } = open(
    async () => found,
    undefined,
    async () => registered.slice(0, 1),
  );
  await titles.refresh(name);
  expect(failure(titles.peer(name))).toMatchObject({ code: 'unknown-project' });
});

test('workspace identity readers share a registry refresh and a cancelled initial read cannot erase its result', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const fresh = Promise.withResolvers<readonly Project[]>();
  let reading = 0;
  const { workspace } = open(
    async () => found,
    undefined,
    (signal) => {
      reading += 1;
      if (reading > 1) return fresh.promise;
      started.resolve(signal);
      return new Promise<readonly Project[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  );
  const signal = await started.promise;
  const one = workspace.nameOf(1);
  const two = workspace.projectsOf([1, 2]);
  fresh.resolve(registered);
  expect(await one).toBe('home');
  expect((await two).map((project) => project.name)).toEqual(['home', 'other']);
  expect(workspace.projects.map((project) => project.id)).toEqual([1, 2]);
  expect(signal.aborted).toBe(true);
});

test('closing the graph cancels title reading without declaring the block absent', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const { titles, scope } = open((_names, signal) => {
    started.resolve(signal);
    return new Promise<Titles>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const reading = titles.refresh(name);
  const signal = await started.promise;
  await scope.close();
  await reading;
  expect(signal.aborted).toBe(true);
  expect(titles.peer(name)).toBeUndefined();
  expect(titles.answered).toBe(0);
});
