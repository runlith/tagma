// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { makeSharedStorage, makeStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import type { Workspace } from '../workspace/Selection.svelte.js';
import { Visits } from '../workspace/Visits.svelte.js';
import { testSurfaces } from '$lib/app/testing.js';
import { ProjectStrip } from './Strip.svelte.js';

const project = (id: number, name: string): Project => ({
  id,
  name,
  repoKey: name,
  rootPath: `/projects/${name}`,
  strictProvenance: false,
  private: false,
  kind: 'folder',
  storage: 'stealth',
  graphRemote: null,
  servesFrom: 'rows',
  createdAt: '2026-10-15T00:00:00Z',
});

const REGISTRY = [project(1, 'alpha'), project(2, 'beta'), project(3, 'gamma')];

const surfaces = testSurfaces();

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function window(storage: PlatformStorage, active: number | null, visits = new Visits(makeStorage(), surfaces)) {
  const at = $state({ active, projects: REGISTRY });
  const workspace = {
    get projects() {
      return at.projects;
    },
    get activeId() {
      return at.projects.find((one) => one.id === at.active)?.id ?? null;
    },
    find: (id: number) => at.projects.find((one) => one.id === id) ?? null,
  } as unknown as Workspace;
  let strip!: ProjectStrip;
  stops.push(
    $effect.root(() => {
      strip = new ProjectStrip(workspace, visits, storage);
    }),
  );
  flushSync();
  const go = (id: number | null) => {
    at.active = id;
    flushSync();
  };
  return { strip, at, go };
}

const names = (projects: readonly Project[]) => projects.map((one) => one.name);

test('entering a project adds it to the strip once and puts it first among the recent', () => {
  const { strip, go } = window(makeStorage(), 1);
  go(2);
  go(1);

  expect(names(strip.projects)).toEqual(['alpha', 'beta']);
  expect(names(strip.recent)).toEqual(['alpha', 'beta']);
  expect(names(strip.cycle)).toEqual(['alpha', 'beta']);
});

test('a removed project stays out until it is entered again, from a page outside any project too, and one gone from the registry leaves', () => {
  const { strip, at, go } = window(makeStorage(), 1);
  go(2);
  go(3);
  strip.remove(3);
  at.projects = [...REGISTRY];
  flushSync();
  go(null);
  expect(names(strip.projects)).toEqual(['alpha', 'beta']);

  go(3);
  expect(names(strip.projects)).toEqual(['alpha', 'beta', 'gamma']);

  at.projects = REGISTRY.filter((one) => one.id !== 2);
  expect(names(strip.projects)).toEqual(['alpha', 'gamma']);
});

test('the project a window stands in, removed from the strip, comes back when that window is focused again', () => {
  const { strip, go } = window(makeStorage(), 1);
  go(2);
  strip.remove(2);
  expect(names(strip.projects)).toEqual(['alpha']);

  globalThis.dispatchEvent(new Event('focus'));
  expect(names(strip.projects)).toEqual(['alpha', 'beta']);
});

test('the strip comes back from storage, and a write keeps what another window changed after this one read it', () => {
  const storage = makeStorage();
  const first = window(storage, 1);
  first.go(2);
  first.strip.show('tabs');
  const second = window(storage, 3);

  first.strip.remove(1);
  first.strip.move(3, 2);

  const reloaded = window(storage, null);
  expect(names(reloaded.strip.projects)).toEqual(['gamma', 'beta']);
  expect(reloaded.strip.view).toBe('tabs');
  expect(names(reloaded.strip.recent)).toEqual(['gamma', 'beta', 'alpha']);
  expect(names(second.strip.recent)).toEqual(['gamma', 'beta', 'alpha']);
});

test('what another window changes in the strip shows in this one at once, and this window keeps its own recent', () => {
  const shared = makeSharedStorage();
  const first = window(shared(), 1);
  first.go(2);
  const second = window(shared(), 3);
  expect(names(first.strip.projects)).toEqual(['alpha', 'beta', 'gamma']);

  second.strip.move(3, 1);
  second.strip.remove(2);
  second.strip.show('tabs');

  expect(names(first.strip.projects)).toEqual(['gamma', 'alpha']);
  expect(first.strip.view).toBe('tabs');
  expect(names(first.strip.recent)).toEqual(['beta', 'alpha']);
});

test('the first strip holds the projects that have a remembered place, in registry order, and the current one', () => {
  const visits = new Visits(makeStorage(), surfaces);
  visits.remember(REGISTRY[2]!, surfaces.home, null, null);
  visits.remember(REGISTRY[0]!, surfaces.home, null, null);

  const { strip } = window(makeStorage(), 2, visits);

  expect(names(strip.projects)).toEqual(['alpha', 'gamma', 'beta']);
});
