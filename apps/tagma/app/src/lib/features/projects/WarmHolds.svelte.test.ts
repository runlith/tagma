// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Layer } from '@runlith/layer/Layer';
import { makeStorage } from '@runlith/layer/testing';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, screen, threadsRepo, type TestApp } from '$lib/app/testing.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { FolderActs } from '$lib/features/threads/FolderActs.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { ProjectStrip } from './Strip.svelte.js';
import WarmHolds from './WarmHolds.svelte';

const project = (id: number): Project => ({
  id,
  name: `p${id}`,
  repoKey: `p${id}`,
  rootPath: `/projects/p${id}`,
  strictProvenance: false,
  private: false,
  global: false,
  storage: 'stealth',
  graphRemote: null,
  servesFrom: 'rows',
  createdAt: '2026-10-15T00:00:00Z',
});

const REGISTRY = [1, 2, 3, 4].map(project);

type Feed = { readonly projectId: number; open: boolean };

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

async function stand(stored: Record<string, string> = {}) {
  const at = $state({ active: 1 });
  const workspace = {
    get projects() {
      return REGISTRY;
    },
    get activeId() {
      return at.active;
    },
    find: (id: number) => REGISTRY.find((one) => one.id === id) ?? null,
  } as unknown as Workspace;
  const feeds: Feed[] = [];
  const live = {
    hold: (open: (client: unknown) => unknown) => {
      const asked = open(new Proxy({}, { get: () => (payload: { projectId: number }) => payload })) as { projectId: number };
      const feed: Feed = { projectId: asked.projectId, open: true };
      feeds.push(feed);
      return {
        unsubscribe: () => {
          feed.open = false;
        },
      };
    },
  };
  const mounted = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, ProjectStrip, Visits, Notices),
    Layer.mergeAll(Layer.of(Workspace, workspace), Layer.of(ThreadsRepo, threadsRepo()), Layer.of(Live, live as never), screen()),
    { at: { projectId: 1, branch: null }, storage: makeStorage(stored) },
  );
  app = mounted;
  const visits = mounted.app.resolve(Visits);
  const go = async (projectId: number, branch: string | null = null): Promise<void> => {
    at.active = projectId;
    mounted.place({ projectId, branch });
    visits.remember(`p${projectId}`, mounted.app.resolve(SurfaceRegistry).home, null, branch);
    await flush();
  };
  mounted.draw(WarmHolds);
  await flush();
  return {
    app: mounted.app,
    go,
    strip: mounted.app.resolve(ProjectStrip),
    standing: () => feeds.map((feed) => [feed.projectId, feed.open]),
  };
}

test('a return to a warm project reuses its list: no second subscription, the same instance', async () => {
  const world = await stand();
  const list = world.app.resolve(ThreadList);

  await world.go(2);
  await world.go(1);

  expect(world.app.resolve(ThreadList)).toBe(list);
  expect(world.standing()).toEqual([
    [1, true],
    [2, true],
  ]);
});

test('entering a fourth project ends the subscriptions of the one entered longest ago', async () => {
  const world = await stand();

  await world.go(2);
  await world.go(3);
  await world.go(4);

  expect(world.standing()).toEqual([
    [1, false],
    [2, true],
    [3, true],
    [4, true],
  ]);
  expect(world.app.hasScope(ProjectRung, { projectId: 1 })).toBe(false);
});

test('a branch left inside a warm project lets its graph scope go, and the branch it stood on stays warm in the background', async () => {
  const world = await stand();
  await world.go(1, 'main');
  const project = world.app.scopeOf('project');

  await world.go(1, 'next');
  await world.go(2);

  expect(world.app.hasScope(GraphRung, { projectId: 1, branch: 'main' }, project)).toBe(false);
  expect(world.app.hasScope(GraphRung, { projectId: 1, branch: 'next' }, project)).toBe(true);
});

test('only projects entered in this window are warm, and one taken off the strip stops being warm', async () => {
  const world = await stand({ 'tagma.strip': JSON.stringify({ members: [1, 2, 3, 4], recent: [4, 3, 2, 1], view: 'dock' }) });
  expect(world.standing()).toEqual([[1, true]]);

  await world.go(2);
  await world.go(3);
  world.strip.remove(2);
  await flush();

  expect(world.standing()).toEqual([
    [1, true],
    [2, false],
    [3, true],
  ]);
});
