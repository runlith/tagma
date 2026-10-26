import { makeSharedStorage, makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { type SeamGeometry, Seams } from './Seams.svelte.js';

const outline: SeamGeometry = { key: 'outline', pane: { base: 300, min: 200, max: 500 } };

test('a seam declared by its owner keeps the size the reader dragged it to across a reload, per place', () => {
  const storage = makeStorage();
  const seams = new Seams(storage);

  expect(seams.seam(outline).size).toBeUndefined();
  seams.set(outline, 333.4, 1);

  const reloaded = new Seams(storage);
  expect(reloaded.seam(outline, 1).size).toBe(333);
  expect(reloaded.seam(outline, 0).size).toBeUndefined();
  expect(reloaded.seam(outline, 1).min).toBe(200);
});

test('a size another window drags reaches this one', () => {
  const window = makeSharedStorage();
  const here = new Seams(window());
  const there = new Seams(window());

  there.set(outline, 420);

  expect(here.size(outline)).toBe(420);
});
