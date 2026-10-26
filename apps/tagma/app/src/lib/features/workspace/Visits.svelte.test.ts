import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { testSurfaces } from '$lib/app/testing.js';
import { Visits } from './Visits.svelte.js';

const surfaces = testSurfaces();

test('two tabs reading different projects both find their places after a reload', () => {
  const storage = makeStorage();
  const first = new Visits(storage, surfaces);
  const second = new Visits(storage, surfaces);

  first.remember('5', 'graph', 'alpha', null);
  second.remember('7', 'journal', 'beta', 'main');
  second.remember('5', 'outline', null, null);

  const reloaded = new Visits(storage, surfaces);
  expect(reloaded.placeOf('5', 'graph')).toBe('alpha');
  expect(reloaded.placeOf('7', 'journal')).toBe('beta');
  expect(reloaded.branchOf('7')).toBe('main');
});

test('a project resumes on the surface it was left on, with that surface’s place, and on the home surface before any visit', () => {
  const storage = makeStorage();
  const visits = new Visits(storage, surfaces);
  expect(visits.resume('5')).toBe(surfaces.pathOf('5', surfaces.home));

  visits.remember('5', 'graph', 'alpha', null);
  visits.remember('5', 'chat', 'thread-1', 'main');
  visits.remember('5', 'outline', 'beta', 'main');
  visits.remember('5', 'chat', 'thread-2', 'main');

  const reloaded = new Visits(storage, surfaces);
  expect(reloaded.resume('5')).toBe('/5/chat/thread-2?branch=main');
  reloaded.remember('5', 'outline', 'beta', 'main');
  expect(new Visits(storage, surfaces).resume('5')).toBe('/5?branch=main');
});
