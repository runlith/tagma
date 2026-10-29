// @vitest-environment jsdom
import type { PlatformStorage } from '@runlith/layer/Platform';
import { makeSharedStorage, makeStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { testSurfaces } from '$lib/app/testing.js';
import { RailPins } from './RailPins.svelte.js';

const DAILY = ['chat', 'checkout', 'outline'];

const SURFACES = testSurfaces();

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function rail(storage: PlatformStorage, daily: readonly string[] = DAILY): RailPins {
  let pins!: RailPins;
  stops.push(
    $effect.root(() => {
      pins = new RailPins(storage, daily, SURFACES);
    }),
  );
  flushSync();
  return pins;
}

test('the rail starts with the daily places, and what the operator pins, moves and unpins comes back after a reload', () => {
  const storage = makeStorage();
  const pins = rail(storage);
  expect(pins.ids).toEqual(['chat', 'checkout', 'outline']);

  pins.pin('rules', null);
  pins.pin('rules', 'chat');
  pins.unpin('checkout');

  expect(rail(storage).ids).toEqual(['rules', 'chat', 'outline']);
});

test('a daily place the operator unpinned stays off after a reload, and one the product makes daily later arrives', () => {
  const storage = makeStorage();
  rail(storage).unpin('chat');

  expect(rail(storage, [...DAILY, 'calls']).ids).toEqual(['checkout', 'outline', 'calls']);
});

test('an app section and launcher pinned under their former plugin ids stand on the rail, and the next write keeps only the new ids', () => {
  const storage = makeStorage();
  storage.setItem('tagma.rail', JSON.stringify({ pinned: ['plugin/crm/deals', 'chat', 'plugin.crm.board'], unpinned: ['plugin/crm/old'] }));
  const pins = rail(storage);

  expect(pins.ids).toEqual(['app/crm/deals', 'chat', 'app.crm.board', 'checkout', 'outline']);
  pins.unpin('outline');
  expect(JSON.parse(storage.getItem('tagma.rail') ?? 'null')).toEqual({
    pinned: ['app/crm/deals', 'chat', 'app.crm.board', 'checkout'],
    unpinned: ['app/crm/old', 'outline'],
  });
});

test('what another window pins shows in this one at once', () => {
  const shared = makeSharedStorage();
  const here = rail(shared());
  const there = rail(shared());

  there.pin('rules', 'checkout');

  expect(here.ids).toEqual(['chat', 'rules', 'checkout', 'outline']);
});
