import { expect, test } from 'vitest';
import { testSurfaces } from './testing.js';

const PROJECT = '/src/routes/[project]/';

const directories = [
  ...new Set(
    Object.keys(import.meta.glob('/src/routes/**/+page.svelte'))
      .filter((path) => path.startsWith(PROJECT))
      .map((path) => path.slice(PROJECT.length).split('/')[0] as string)
      .map((first) => (first === '+page.svelte' ? '' : first)),
  ),
];

test('every project route directory is declared by a surface, and every declared route has its directory', () => {
  const surfaces = testSurfaces();
  expect(directories).toContain('');
  expect(directories.filter((directory) => surfaces.owner(directory) === undefined)).toEqual([]);
  expect(surfaces.routes.filter((route) => !directories.includes(route))).toEqual([]);
});
