import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { directoriesAt, listedAt, prepareDirectories } from './directories';
import { entriesAt } from './git';
import { databaseAt } from './store';
import { sideTree } from './trees';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'law-directories-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git('init', '-q');
  return { root, git, put };
};

const PROBES = [
  [],
  ['src/'],
  ['src'],
  ['src/a.ts'],
  ['src/deep/nested/'],
  ['src/spaced name.ts', 'docs/note\nbreak.md'],
  ['link', 'vendor'],
  ['moved/', 'docs/'],
  ['absent/', 'src/absent.ts'],
] as const;

const sameAsGit = (root: string, revision: string): void => {
  for (const paths of PROBES)
    for (const recursive of [false, true])
      expect([...listedAt(root, revision, paths, recursive)].sort()).toEqual([...entriesAt(root, revision, paths, recursive)].sort());
};

test('a catalogue seeded once and derived by changed directories answers every listing and probe as git does, per revision, with links, submodules and awkward names', () => {
  const { root, git, put } = fixture();
  try {
    put('src/a.ts', 'export const a = 1;\n');
    put('src/spaced name.ts', 'export const spaced = 1;\n');
    put('src/deep/nested/leaf.ts', 'export const leaf = 1;\n');
    put('docs/note\nbreak.md', 'note\n');
    put('docs/kept.md', 'kept\n');
    put('old/place.ts', 'export const place = 1;\n');
    symlinkSync('src/a.ts', join(root, 'link'));
    git('add', '.');
    git('update-index', '--add', '--cacheinfo', '160000,1111111111111111111111111111111111111111,vendor');
    const base = git('write-tree');

    put('src/b.ts', 'export const b = 1;\n');
    git('rm', '-q', '-f', 'src/a.ts');
    git('mv', 'old', 'moved');
    put('docs/kept.md', 'kept, edited\n');
    rmSync(join(root, 'link'));
    symlinkSync('src/b.ts', join(root, 'link'));
    git('add', '.');
    git('update-index', '--add', '--cacheinfo', '160000,2222222222222222222222222222222222222222,vendor');
    const tree = git('write-tree');
    put('extra.ts', 'export const extra = 1;\n');
    git('add', 'extra.ts');
    const unseeded = git('write-tree');

    expect(directoriesAt(root, base)).toBeUndefined();
    sameAsGit(root, base);

    expect(() => prepareDirectories(root, tree, unseeded)).toThrow('directory catalogue');
    expect(directoriesAt(root, tree)).toBeUndefined();
    prepareDirectories(root, base, null);
    expect(directoriesAt(root, base)).toBeDefined();
    prepareDirectories(root, tree, base);

    sameAsGit(root, base);
    sameAsGit(root, tree);

    const before = directoriesAt(root, base)!;
    const after = directoriesAt(root, tree)!;
    expect([before.entry('src/a.ts')?.kind, after.entry('src/a.ts')?.kind]).toEqual(['blob', undefined]);
    expect([before.entry('src/b.ts')?.kind, after.entry('src/b.ts')?.kind]).toEqual([undefined, 'blob']);
    expect([before.entry('old/place.ts')?.kind, after.entry('old/place.ts')?.kind]).toEqual(['blob', undefined]);
    expect([before.entry('moved/place.ts')?.kind, after.entry('moved/place.ts')?.kind]).toEqual([undefined, 'blob']);
    expect([before.entry('link')?.mode, before.entry('vendor')?.kind]).toEqual(['120000', 'commit']);
    expect(before.entry('link')?.object).not.toBe(after.entry('link')?.object);
    expect(before.entry('src/deep/nested')?.object).toBe(after.entry('src/deep/nested')?.object);

    const supplied = sideTree(
      root,
      tree,
      { side: 'tree', paths: ['src/b.ts'], files: [{ path: 'src/b.ts', text: 'export const b = 1;\n' }] },
      [],
      () => true,
      new Map(),
    );
    expect(
      ['src/b.ts', 'src/spaced name.ts', 'src/deep/nested/leaf.ts', 'moved/place.ts', 'docs/kept.md'].map((path) => supplied.has(path)),
    ).toEqual([true, true, true, true, true]);
    expect(['src/a.ts', 'old/place.ts', 'src/absent.ts', 'src/spaced name.ts/x'].map((path) => supplied.has(path))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(supplied.object?.('src/deep/nested/leaf.ts')).toBe(before.entry('src/deep/nested/leaf.ts')?.object);
    expect(() => supplied.read('link')).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a revision whose catalogue lost a directory fails the probe naming the remeasure instead of falling back to git', () => {
  const { root, git, put } = fixture();
  try {
    put('src/a.ts', 'export const a = 1;\n');
    put('lib/b.ts', 'export const b = 1;\n');
    git('add', '.');
    const base = git('write-tree');
    prepareDirectories(root, base, null);
    const lib = directoriesAt(root, base)!.entry('lib')!.object;
    databaseAt(root).query('DELETE FROM nodes WHERE tree = ?').run(lib);
    const lost = sideTree(root, base, { side: 'tree', paths: [], files: [] }, [], () => true, new Map());
    expect(() => lost.has('src/a.ts')).not.toThrow();
    expect(() => lost.has('lib/b.ts')).toThrow('directory catalogue');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
