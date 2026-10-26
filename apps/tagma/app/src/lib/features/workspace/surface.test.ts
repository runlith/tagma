import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { RegistryClash } from '@runlith/chat-ui/RegistryClash';
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { type SurfaceDeclaration, SurfaceRegistry } from './surface.js';
import { Visits } from './Visits.svelte.js';

const icon = (() => undefined) as unknown as SurfaceDeclaration['icon'];

const project: Project = {
  id: 1,
  name: 'demo',
  repoKey: 'demo',
  rootPath: '/projects/demo',
  strictProvenance: false,
  private: false,
  global: false,
  storage: 'stealth',
  graphRemote: null,
  servesFrom: 'rows',
  createdAt: '2026-09-05T00:00:00Z',
};

const declared = (surface: string, over: Partial<SurfaceDeclaration> = {}): SurfaceDeclaration => ({
  surface,
  route: surface,
  label: surface,
  icon,
  stands: 'graph',
  remembers: true,
  ...over,
});

const registry = () =>
  new SurfaceRegistry([
    declared('home', { route: '', place: 'b', rail: 20, column: 'shelf' }),
    declared('mail', { rail: 10, home: true }),
    declared('archive', { under: 'home' }),
  ]);

test('a route id belongs to the surface that declared its directory, and the project root to the surface with the empty route', () => {
  const surfaces = registry();

  expect(surfaces.of('/[project]/mail/[[id]]')).toBe('mail');
  expect(surfaces.of('/[project]/b/[id]')).toBe('home');
  expect(surfaces.of('/[project]')).toBe('home');
  expect(surfaces.of('/[project]/archive')).toBe('archive');
  expect(surfaces.owner('b')).toBe('home');
});

test('the rail lists the surfaces that asked for a place in their order, a surface under another is lit with it and shares its column', () => {
  const surfaces = registry();

  expect(surfaces.rail.map((one) => one.surface)).toEqual(['mail', 'home']);
  expect(surfaces.home).toBe('mail');
  expect(surfaces.railOf('archive')).toBe('home');
  expect(surfaces.columnOf('archive')).toBe('shelf');
  expect(surfaces.columnOf('mail')).toBeUndefined();
});

test('a place of a surface lives under its place directory, the root surface under the project itself', () => {
  const surfaces = registry();

  expect(surfaces.pathOf('runlith', 'home', 'block-1')).toBe('/runlith/b/block-1');
  expect(surfaces.pathOf('runlith', 'mail', 'thread-1')).toBe('/runlith/mail/thread-1');
  expect(surfaces.pathOf('runlith', 'home')).toBe('/runlith');
});

test('a doubled surface or route, a missing or doubled home, an undeclared under and the visit record’s own name refuse at assembly', () => {
  const home = declared('home', { home: true, rail: 1 });

  expect(() => new SurfaceRegistry([home, declared('a', { route: 'x' }), declared('b', { route: 'x' })])).toThrow(RegistryClash);
  expect(() => new SurfaceRegistry([home, declared('a'), declared('a', { route: 'other' })])).toThrow(RegistryClash);
  expect(() => new SurfaceRegistry([declared('a', { rail: 1 })])).toThrow(RegistryClash);
  expect(() => new SurfaceRegistry([home, declared('b', { home: true, rail: 2 })])).toThrow(RegistryClash);
  expect(() => new SurfaceRegistry([home, declared('a', { under: 'nowhere' })])).toThrow(RegistryClash);
  expect(() => new SurfaceRegistry([home, declared('branch')])).toThrow(RegistryClash);
});

test('a section registered on the fly joins the rail and answers its route until its disposer runs', () => {
  const surfaces = new SurfaceRegistry([
    declared('mail', { rail: 10, home: true }),
    declared('plugin', { route: 'p', nested: true, remembers: false }),
  ]);
  const params = { project: 'runlith', plugin: 'crm', view: 'deals' };
  const section = declared('plugin/crm/deals', { route: 'p/crm/deals', rail: 100, remembers: false });

  expect(surfaces.of('/[project]/p/[plugin]/[view]', params)).toBe('plugin');
  const release = surfaces.register(section);
  expect(surfaces.of('/[project]/p/[plugin]/[view]', params)).toBe('plugin/crm/deals');
  expect(surfaces.of('/[project]/p/[plugin]/[view]', { ...params, view: 'other' })).toBe('plugin');
  expect(surfaces.rail.map((one) => one.surface)).toEqual(['mail', 'plugin/crm/deals']);
  expect(surfaces.pathOf('runlith', 'plugin/crm/deals')).toBe('/runlith/p/crm/deals');
  expect(surfaces.portable('plugin/crm/deals')).toBe(false);
  expect(() => surfaces.register(section)).toThrow(RegistryClash);

  release();
  expect(surfaces.of('/[project]/p/[plugin]/[view]', params)).toBe('plugin');
  expect(surfaces.rail.map((one) => one.surface)).toEqual(['mail']);
  expect(surfaces.find('plugin/crm/deals')).toBeUndefined();
});

test('a visit remembers a place only on the surfaces that declared it', () => {
  const surfaces = new SurfaceRegistry([declared('home', { route: '', remembers: false, home: true, rail: 1 }), declared('mail')]);
  const visits = new Visits(makeStorage(), surfaces);
  const five = { ...project, id: 5, name: '5' };

  visits.remember(five, 'home', 'ignored', null);
  visits.remember(five, 'mail', 'thread-1', 'main');

  expect(visits.placeOf(five, 'home')).toBeNull();
  expect(visits.href(five, 'mail')).toBe('/5/mail/thread-1?branch=main');
});
