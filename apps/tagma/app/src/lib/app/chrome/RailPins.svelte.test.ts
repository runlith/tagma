// @vitest-environment jsdom
import type { PlatformStorage } from '@runlith/layer/Platform';
import { makeSharedStorage, makeStorage } from '@runlith/layer/testing';
import { makeReactivePoint } from '@runlith/layer/testing/svelte';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { type SurfaceDeclaration, SurfaceRegistry, Surfaces } from '$lib/features/workspace/surface.js';
import { RailPins } from './RailPins.svelte.js';

const place = (surface: string, rail: number): SurfaceDeclaration => ({
  surface,
  route: surface,
  label: surface,
  icon: (() => undefined) as unknown as SurfaceDeclaration['icon'],
  rail,
  stands: 'project',
  remembers: false,
});

const daily = (surface: string, rail: number): SurfaceDeclaration => ({ ...place(surface, rail), pinned: true });

const POINT = makeReactivePoint(Surfaces, daily('chat', 1), daily('checkout', 2), daily('outline', 3), place('rules', 4), {
  surface: 'app',
  formerly: 'plugin',
  route: 'p',
  label: 'App',
  icon: (() => undefined) as unknown as SurfaceDeclaration['icon'],
  stands: 'project',
  remembers: false,
  nested: true,
});

const SURFACES = new SurfaceRegistry(POINT);

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function rail(storage: PlatformStorage): RailPins {
  let pins!: RailPins;
  stops.push(
    $effect.root(() => {
      pins = new RailPins(storage, SURFACES);
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

test('a daily place the operator unpinned stays off after a reload, and one a contribution makes daily later arrives on a standing rail', () => {
  const storage = makeStorage();
  rail(storage).unpin('chat');
  const pins = rail(storage);
  expect(pins.ids).toEqual(['checkout', 'outline']);

  const leave = POINT.register('features/notes', daily('notes', 5));
  flushSync();
  expect(pins.ids).toEqual(['checkout', 'outline', 'notes']);
  leave();
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
