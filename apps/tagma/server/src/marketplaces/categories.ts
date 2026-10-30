import type { CatalogCategory } from './contract/wire/rows.js';

const SAID: ReadonlyMap<string, CatalogCategory> = new Map([
  ['development', 'Development'],
  ['developer tools', 'Development'],
  ['testing', 'Development'],
  ['deployment', 'Development'],
  ['migration', 'Development'],
  ['productivity', 'Productivity'],
  ['automation', 'Productivity'],
  ['business & operations', 'Productivity'],
  ['database', 'Data'],
  ['data', 'Data'],
  ['data & analytics', 'Data'],
  ['analytics', 'Data'],
  ['monitoring', 'Monitoring'],
  ['observability', 'Monitoring'],
  ['security', 'Security'],
  ['design', 'Design'],
  ['creativity', 'Design'],
  ['communication', 'Communication'],
  ['learning', 'Learning'],
  ['education', 'Learning'],
  ['education & research', 'Learning'],
  ['scientific research', 'Learning'],
  ['research', 'Learning'],
  ['math', 'Learning'],
  ['finance', 'Finance'],
]);

export const categoryOf = (said: string | null): CatalogCategory | null => {
  const word = said?.trim().toLowerCase() ?? '';
  return word === '' ? null : (SAID.get(word) ?? 'Other');
};
