import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { symlink } from 'node:fs/promises';
import { Effect } from 'effect';
import { feeding, filesWorld, worldLayers } from '../testing/world.js';

it.live('a directory lists directories first by name with digits by value, hides the graph tree, and pages by cursor', () =>
  Effect.gen(function* () {
    const { root, place, directories, write, files, paths, spawned } = yield* filesWorld;
    yield* write('b.txt', 'b');
    yield* write('A.txt', 'a');
    yield* write('10.txt', 'x');
    yield* write('9.txt', 'x');
    yield* write('src/index.ts', 'x');
    yield* write('build/out.js', 'x');
    yield* write('.gitignore', 'build/\n');
    yield* write('.DS_Store', 'x');
    yield* write('.tagma/graph.db', 'x');
    yield* files.makeDirectory(paths.join(root, '..', 'elsewhere'));
    yield* Effect.promise(() => symlink('src', paths.join(root, 'srclink')));
    yield* Effect.promise(() => symlink('../elsewhere', paths.join(root, 'away')));
    yield* Effect.promise(() => symlink('nowhere', paths.join(root, 'dangling')));

    const first = yield* directories.list(place, { path: '', ignored: false, rows: 100, cursor: undefined });
    expect(first.rows.map((entry) => `${entry.name}:${entry.kind}${entry.ignored ? ':ignored' : ''}`)).toEqual([
      'build:directory:ignored',
      'src:directory',
      'srclink:link',
      '.gitignore:file',
      '9.txt:file',
      '10.txt:file',
      'A.txt:file',
      'away:link',
      'b.txt:file',
      'dangling:link',
    ]);
    expect(first.rows.filter((entry) => entry.kind === 'link').map((entry) => entry.target)).toEqual(['directory', 'outside', 'broken']);
    expect(first.total).toBe(10);

    const paged = yield* directories.list(place, { path: '', ignored: false, rows: 4, cursor: undefined });
    expect(paged.next).not.toBeNull();
    const rest = yield* directories.list(place, { path: '', ignored: false, rows: 100, cursor: paged.next ?? undefined });
    expect([...paged.rows, ...rest.rows].map((entry) => entry.name)).toEqual(first.rows.map((entry) => entry.name));

    const before = spawned.length;
    const inside = yield* directories.list(place, { path: 'build', ignored: true, rows: 10, cursor: undefined });
    expect(inside.rows).toEqual([{ name: 'out.js', kind: 'file', ignored: true }]);
    expect(spawned.length).toBe(before);

    const refused = yield* Effect.flip(directories.list(place, { path: '../elsewhere', ignored: false, rows: 10, cursor: undefined }));
    expect(refused.code).toBe('path-outside-tree');
    const graph = yield* Effect.flip(directories.list(place, { path: '.tagma', ignored: false, rows: 10, cursor: undefined }));
    expect(graph.code).toBe('graph-path');
    const file = yield* Effect.flip(directories.list(place, { path: 'b.txt', ignored: false, rows: 10, cursor: undefined }));
    expect(file.code).toBe('not-a-directory');
  }).pipe(Effect.provide(worldLayers)),
);

it.live('creating a file in a directory sends one tree frame naming that directory alone', () =>
  Effect.gen(function* () {
    const { place, directories, write, files, paths, root } = yield* filesWorld;
    yield* files.makeDirectory(paths.join(root, 'src'));
    const frames = yield* feeding(directories.tree(place.rootId));
    expect(yield* frames.next).toEqual({ kind: 'rescan', reason: 'opened' });
    yield* write('src/new.ts', 'x');
    const named = yield* frames.until((frame) => frame.kind === 'dirs');
    expect(named).toEqual({ kind: 'dirs', dirs: ['src'] });
  }).pipe(Effect.provide(worldLayers)),
);

it.live('a page continued after the directory changed still walks the directory as it now stands', () =>
  Effect.gen(function* () {
    const { place, directories, write } = yield* filesWorld;
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) yield* write(`${name}.txt`, 'x');
    const first = yield* directories.list(place, { path: '', ignored: false, rows: 3, cursor: undefined });
    yield* write('z.txt', 'x');
    const rest = yield* directories.list(place, { path: '', ignored: false, rows: 10, cursor: first.next ?? undefined });
    expect([...first.rows, ...rest.rows].map((entry) => entry.name)).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
      'd.txt',
      'e.txt',
      'f.txt',
      'z.txt',
    ]);
  }).pipe(Effect.provide(worldLayers)),
);
