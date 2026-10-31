import { RegistryClash } from '@runlith/roster/RegistryClash';
import type { Resolver } from '@runlith/layer/key';
import { makePoint } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { type ColumnDeclaration, Columns, type ColumnState } from '$lib/features/workspace/column.js';
import { type SurfaceDeclaration, SurfaceRegistry, Surfaces } from '$lib/features/workspace/surface.js';
import { ColumnRegistry } from './ColumnRegistry.js';

const icon = (() => undefined) as unknown as SurfaceDeclaration['icon'];

class Inbox implements ColumnState {
  open = true;
  toggle(): void {
    this.open = !this.open;
  }
}

class Preferences extends Inbox {}

const states = new Map<unknown, ColumnState>([
  [Inbox, new Inbox()],
  [Preferences, new Preferences()],
]);

const app = { resolve: (key: unknown) => states.get(key) } as unknown as Resolver;

const surfaces = new SurfaceRegistry(
  makePoint(
    Surfaces,
    { surface: 'mail', route: 'mail', label: 'Mail', icon, rail: 1, home: true, stands: 'graph', column: 'inbox', remembers: true },
    { surface: 'notes', route: 'notes', label: 'Notes', icon, rail: 2, stands: 'graph', remembers: true },
  ),
);

const inbox = { id: 'inbox', label: 'inbox column', state: Inbox } as unknown as ColumnDeclaration;

const preferences = {
  id: 'preferences',
  label: 'preferences column',
  state: Preferences,
  routes: ['/preferences'],
  room: () => false,
} as unknown as ColumnDeclaration;

const registry = (...declarations: readonly ColumnDeclaration[]) => new ColumnRegistry(surfaces, makePoint(Columns, ...declarations));

test('a surface opens the column it declared, one with none has none, and the column is the same object each time', () => {
  const columns = registry(inbox, preferences);

  const column = columns.of('mail', app);
  expect(column?.label).toBe('inbox column');
  expect(columns.of('notes', app)).toBeNull();
  expect(columns.of('mail', app)).toBe(column);

  column?.toggle();
  expect(columns.of('mail', app)?.open).toBe(false);
});

test('a column standing on a global route is found by that route and is absent while its room says no', () => {
  const desk = { id: 'desk', label: 'desk column', state: Inbox, routes: ['/desk'] } as unknown as ColumnDeclaration;
  const columns = registry(inbox, preferences, desk);

  expect(columns.at('/[project]/mail/[[id]]', true, app)?.id).toBe('inbox');
  expect(columns.at('/desk', false, app)?.id).toBe('desk');
  expect(columns.at('/preferences', false, app)).toBeNull();
});

test('a surface naming a column this build lacks opens none, and two columns sharing an id or a route refuse', () => {
  expect(registry(preferences).of('mail', app)).toBeNull();
  expect(() => registry(inbox, inbox)).toThrow(RegistryClash);
  expect(() => registry(inbox, preferences, { ...preferences, id: 'other' })).toThrow(RegistryClash);
});
