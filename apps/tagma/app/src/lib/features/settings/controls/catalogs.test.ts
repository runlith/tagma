import { expect, test } from 'vitest';
import { type CatalogEntry, catalogGroups } from './catalogs.js';

const entry = (value: string, group: string): CatalogEntry => ({ value, label: value, group, swatches: [] });

test('the grouping holds every entry once, each under its own group, groups in the order they first appear', () => {
  const entries = [entry('theme', 'Theme'), entry('Night', 'Dark'), entry('Day', 'Light'), entry('Dusk', 'Dark')];

  expect(catalogGroups(entries).map((group) => [group.label, group.entries.map((one) => one.value)])).toEqual([
    ['Theme', ['theme']],
    ['Dark', ['Night', 'Dusk']],
    ['Light', ['Day']],
  ]);
});
