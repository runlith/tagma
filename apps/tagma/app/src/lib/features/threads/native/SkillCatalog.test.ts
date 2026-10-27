// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';
import { Scope } from '@runlith/layer/Scope';
import { QueryClient } from '@tanstack/query-core';
import { keyed } from '@runlith/query/builders/keyed';
import type { AgentSkillCatalog } from '@tagma/server/threads/contract/wire/agentLibrary';
import type { SkillCatalogKey } from '../library/AgentLibraryRepo.js';
import { SkillCatalog } from './SkillCatalog.svelte.js';

function deferred() {
  let resolve!: (value: AgentSkillCatalog) => void;
  const promise = new Promise<AgentSkillCatalog>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const answer = (id: string): AgentSkillCatalog => ({ skills: [{ id, description: id }], available: true, basis: 'thread', note: null });
const nextTurnAnswer = (id: string): AgentSkillCatalog => ({ ...answer(id), basis: 'next-turn' });

function world(load: (key: SkillCatalogKey) => Promise<AgentSkillCatalog>) {
  const app = Scope.make();
  const view = app.child('composer');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const family = keyed<SkillCatalogKey, AgentSkillCatalog>({
    name: 'skills',
    scope: app,
    queryClient: client,
    loader: ({ key }) => load(key),
  });
  const catalog = new SkillCatalog(family, 1, view);
  return {
    catalog,
    family,
    view,
    close: async () => {
      await app.close();
      client.clear();
    },
  };
}

test('a late catalog cannot replace the thread now on screen', async () => {
  const first = deferred();
  const second = deferred();
  const stand = world((key) => (key.aim.kind === 'thread' && key.aim.id === 'first' ? first.promise : second.promise));
  try {
    stand.catalog.aim({ kind: 'thread', id: 'first' }, 'run-first');
    const firstRead = stand.catalog.refreshCurrent();
    stand.catalog.aim({ kind: 'thread', id: 'second' }, 'run-second');
    second.resolve(answer('second-skill'));
    await waitFor(() => expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['second-skill']));
    first.resolve(answer('first-skill'));
    await firstRead;
    expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['second-skill']);
  } finally {
    await stand.close();
  }
});

test('closing the view releases its wait without cancelling the app-owned query', async () => {
  const pending = deferred();
  const stand = world(() => pending.promise);
  const aim = { kind: 'thread' as const, id: 'thread' };
  try {
    stand.catalog.aim(aim, 'run');
    await stand.view.close();
    pending.resolve(answer('kept-in-cache'));
    await waitFor(() => expect(stand.family.key({ projectId: 1, aim, runId: 'run' }).watch()?.skills[0]?.id).toBe('kept-in-cache'));
    expect(stand.catalog.view.items).toEqual([]);
  } finally {
    await stand.close();
  }
});

test('a stepping run re-reads a next-turn catalog once, not once per step', async () => {
  let reads = 0;
  const stand = world(async () => {
    reads += 1;
    return nextTurnAnswer('skill');
  });
  try {
    stand.catalog.aim({ kind: 'thread', id: 'thread' }, 'run-one');
    await waitUntil(() => reads === 1);
    for (let step = 0; step < 5; step += 1) await stand.catalog.refreshCurrent();
    expect(reads).toBe(2);

    stand.catalog.aim({ kind: 'thread', id: 'thread' }, 'run-two');
    await waitUntil(() => reads === 3);
    for (let step = 0; step < 5; step += 1) await stand.catalog.refreshCurrent();
    expect(reads).toBe(4);
  } finally {
    await stand.close();
  }
});

test('opening the menu reads again, so a catalog left waiting still answers', async () => {
  const stuck = deferred();
  let reads = 0;
  const stand = world(() => {
    reads += 1;
    return reads === 1 ? stuck.promise : Promise.resolve(answer('late-skill'));
  });
  try {
    stand.catalog.aim({ kind: 'draft' }, null);
    await waitUntil(() => reads === 1);
    const firstRead = stand.catalog.refreshCurrent();
    expect(stand.catalog.view.state).toBe('loading');
    await stand.catalog.view.onOpen!();
    expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['late-skill']);
    stuck.resolve(answer('never-shown'));
    await firstRead;
    expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['late-skill']);
  } finally {
    await stand.close();
  }
});

test('a new run of the same thread keeps the list on screen while the next read runs', async () => {
  const second = deferred();
  let reads = 0;
  const stand = world(() => {
    reads += 1;
    return reads === 1 ? Promise.resolve(answer('first-skill')) : second.promise;
  });
  try {
    stand.catalog.aim({ kind: 'thread', id: 'thread' }, 'run-one');
    await waitFor(() => expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['first-skill']));
    stand.catalog.aim({ kind: 'thread', id: 'thread' }, 'run-two');
    await waitUntil(() => reads === 2);
    expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['first-skill']);
    second.resolve(answer('second-skill'));
    await waitFor(() => expect(stand.catalog.view.items.map((skill) => skill.id)).toEqual(['second-skill']));
  } finally {
    await stand.close();
  }
});

test('a refused read is not rendered as an empty successful catalog', async () => {
  const stand = world(async () => {
    throw new Error('The recipient cannot be read.');
  });
  try {
    stand.catalog.aim({ kind: 'draft' }, null);
    await waitUntil(() => stand.catalog.view.state === 'failed');
    expect(stand.catalog.view.notice).toBe('The recipient cannot be read.');
  } finally {
    await stand.close();
  }
});
