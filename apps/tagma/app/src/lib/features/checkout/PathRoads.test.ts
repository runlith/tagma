import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { expect, test } from 'vitest';
import { PathRoads } from './PathRoads.js';

const PLACE = { projectId: 1, checkout: 'root-main' as RootId, root: '/work/main', path: 'migrations' };

const ANSWERS: Record<string, unknown> = {
  'src/a.ts': {
    entry: { kind: 'file', path: '/work/main/src/a.ts', bytes: 1, mediaType: 'text/plain' },
    place: { ...PLACE, path: 'src/a.ts' },
  },
  'migrations/': { entry: { kind: 'directory', path: '/work/main/migrations' }, place: PLACE },
  '/tmp/x': { entry: { kind: 'directory', path: '/tmp/x' }, place: null },
  '/missing': { entry: null, place: null },
};

const from = { project: 1, folder: '/work/main' };

const linked = async (local: boolean, path: string) => {
  const opener = { resolve: async (asked: string) => ANSWERS[asked] } as never;
  const made = await new PathRoads(opener, { local } as never).road(from)(path, new AbortController().signal);
  return made === null ? null : made({ path, line: 3, column: null });
};

test('a path the server answers as a directory links to that directory, one outside every checkout only through a door to the machine’s file manager, and a file to the file at its line', async () => {
  expect(await linked(false, 'migrations/')).toEqual({
    kind: 'directory',
    target: { absolute: '/work/main/migrations', place: PLACE },
    from,
  });
  expect(await linked(false, '/tmp/x')).toBeNull();
  expect(await linked(true, '/tmp/x')).toEqual({ kind: 'directory', target: { absolute: '/tmp/x', place: null }, from });
  expect(await linked(true, '/missing')).toBeNull();
  expect(await linked(false, 'src/a.ts')).toEqual({ kind: 'file', target: { path: 'src/a.ts', line: 3, column: null }, from });
});
