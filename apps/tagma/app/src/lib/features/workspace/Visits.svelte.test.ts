// @vitest-environment jsdom
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { makeSharedStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { readyState, testSurfaces } from '$lib/app/testing.js';
import { Visits } from './Visits.svelte.js';

const surfaces = testSurfaces();

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

test('two tabs reading different projects both find their places after a reload', () => {
  const storage = readyState();
  const first = new Visits(storage, surfaces);
  const second = new Visits(storage, surfaces);

  first.remember(project(5, 'five'), 'graph', 'alpha', null);
  second.remember(project(7, 'seven'), 'journal', 'beta', 'main');
  second.remember(project(5, 'five'), 'outline', null, null);

  const reloaded = new Visits(storage, surfaces);
  expect(reloaded.placeOf(project(5, 'five'), 'graph')).toBe('alpha');
  expect(reloaded.placeOf(project(7, 'seven'), 'journal')).toBe('beta');
  expect(reloaded.branchOf(project(7, 'seven'))).toBe('main');
});

test('two windows standing on different surfaces of one project each record their arrival without trading writes', () => {
  const shared = makeSharedStorage();
  const here = new Visits(readyState(shared()), surfaces);
  const there = new Visits(readyState(shared()), surfaces);
  const at = $state({ here: 'graph', there: 'journal' });
  const stop = $effect.root(() => {
    $effect(() => here.remember(project(5, 'five'), at.here, 'alpha', null));
    $effect(() => there.remember(project(5, 'five'), at.there, 'beta', null));
  });
  flushSync();
  at.here = 'chat';
  flushSync();
  expect([there.placeOf(project(5, 'five'), 'chat'), there.placeOf(project(5, 'five'), 'journal')]).toEqual(['alpha', 'beta']);
  stop();
});

test('a project resumes on the surface it was left on, with that surface’s place, under the name it has now', () => {
  const storage = readyState();
  const visits = new Visits(storage, surfaces);
  expect(visits.resume(project(5, 'five'))).toBe(surfaces.pathOf('five', surfaces.home));

  visits.remember(project(5, 'five'), 'graph', 'alpha', null);
  visits.remember(project(5, 'five'), 'chat', 'thread-1', 'main');
  visits.remember(project(5, 'five'), 'outline', 'beta', 'main');
  visits.remember(project(5, 'five'), 'chat', 'thread-2', 'main');

  const reloaded = new Visits(storage, surfaces);
  expect(reloaded.resume(project(5, 'renamed'))).toBe('/renamed/chat/thread-2?branch=main');
  reloaded.remember(project(5, 'renamed'), 'outline', 'beta', 'main');
  expect(new Visits(storage, surfaces).resume(project(5, 'renamed'))).toBe('/renamed?branch=main');
});

test('the entry project opens at the place its root names until the window has a visit of its own', () => {
  const storage = readyState();
  const visits = new Visits(storage, surfaces, { project: 'five', at: { surface: 'chat', place: 'thread-1' } });
  expect(visits.resume(project(5, 'five'))).toBe('/five/chat/thread-1');
  expect(visits.resume(project(7, 'seven'))).toBe(surfaces.pathOf('seven', surfaces.home));

  visits.remember(project(5, 'five'), 'graph', 'alpha', null);
  expect(visits.resume(project(5, 'five'))).toBe(surfaces.pathOf('five', 'graph', 'alpha'));
});

test('a visit or entry naming a surface this build lacks resumes at home', () => {
  const storage = readyState();
  storage.setItem('tagma.visits', JSON.stringify({ 5: { surface: 'elsewhere', elsewhere: 'x', branch: null } }));
  const home = (name: string) => surfaces.pathOf(name, surfaces.home);
  expect(new Visits(storage, surfaces).resume(project(5, 'five'))).toBe(home('five'));
  const entered = new Visits(readyState(), surfaces, { project: 'seven', at: { surface: 'elsewhere', place: 'x' } });
  expect(entered.resume(project(7, 'seven'))).toBe(home('seven'));
});
