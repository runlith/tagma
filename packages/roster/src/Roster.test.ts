import { describe, expect, it } from 'vitest';

import type { Cell } from './cell.js';
import { RegistryClash } from './RegistryClash.js';
import { Roster } from './Roster.js';

type Item = { readonly id: string; readonly order: number };

function roster(): Roster<Item> {
  const cell: Cell<readonly Item[]> = { current: undefined };
  return new Roster<Item>(
    (key) => `Item "${key}"`,
    (item) => item.id,
    cell,
    { order: (item) => item.order },
  );
}

describe('Roster', () => {
  it('lists items by order, keeping arrival among equals, and a disposer takes back only its own items', () => {
    const list = roster();
    const leave = list.add('a', { id: 'late', order: 9 }, { id: 'first', order: 1 });
    list.add('b', { id: 'tie', order: 1 });

    expect(list.items.map((item) => item.id)).toEqual(['first', 'tie', 'late']);
    expect(list.find('tie')?.order).toBe(1);

    leave();
    leave();
    expect(list.items.map((item) => item.id)).toEqual(['tie']);
  });

  it('refuses a second contributor of one key naming both, and adds none of the refused batch', () => {
    const list = roster();
    list.add('features/a', { id: 'x', order: 0 });

    const refused = (() => {
      try {
        list.add('features/b', { id: 'y', order: 0 }, { id: 'x', order: 0 });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(refused).toBeInstanceOf(RegistryClash);
    expect((refused as RegistryClash).holders).toEqual(['features/a', 'features/b']);
    expect(list.items.map((item) => item.id)).toEqual(['x']);
  });

  it('refuses a second claimant of one claim under another key, and a disposer frees the claim', () => {
    const cell: Cell<readonly Item[]> = { current: undefined };
    const list = new Roster<Item>(
      (key) => `Item "${key}"`,
      (item) => item.id,
      cell,
      { claims: (item) => [`Rank ${item.order}`] },
    );
    const leave = list.add('features/a', { id: 'x', order: 1 });

    expect(() => list.add('features/b', { id: 'y', order: 1 })).toThrow(RegistryClash);

    leave();
    list.add('features/b', { id: 'y', order: 1 });
    expect(list.items.map((item) => item.id)).toEqual(['y']);
  });
});
