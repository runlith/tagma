// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { makePlatform, makeRouter, makeStorage } from '@runlith/layer/testing';
import { stubSingle } from '@runlith/query/testing';
import { expect, test } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';
import { liveFeed } from '$lib/app/testing.js';
import { ProjectsFeed } from './ProjectsFeed.js';
import { Workspace } from './Selection.svelte.js';

const project = (id: number, name: string): Project => ({
  id,
  name,
  repoKey: name,
  rootPath: `/projects/${name}`,
  strictProvenance: false,
  private: false,
  kind: 'folder',
  storage: 'stealth',
  servesFrom: 'rows',
  createdAt: '2026-09-05T00:00:00Z',
});

test('a project registered by another door appears in the open workspace when the registry feed moves', async () => {
  const registry = [project(1, 'first')];
  const failure = new Failure((error) => {
    throw error;
  });
  const workspace = new Workspace(
    {
      list: stubSingle({ loadOrThrow: async () => [...registry], refresh: async () => [...registry] }),
      groups: stubSingle({ loadOrThrow: async () => [], refresh: async () => [] }),
    } as never,
    makeRouter({ params: {} }),
    makePlatform({ local: makeStorage() }),
    failure,
  );
  const feed = liveFeed();
  new ProjectsFeed(feed.live, workspace, { defer: () => undefined } as never, failure);
  await waitUntil(() => workspace.loaded);
  expect(workspace.projects.map((one) => one.name)).toEqual(['first']);

  registry.push(project(2, 'billing-backend'));
  feed.routes.get('projects.subscribe')?.({ revision: 2 });

  await waitFor(() => expect(workspace.projects.map((one) => one.name)).toEqual(['first', 'billing-backend']));
});
