import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Side } from '@runlith/tagma/rules';
import type { DeadParams, RepeatedParams } from './declaration';
import { revisionAt, saveRevision } from './memo';
import { programs } from './program';

const dead: DeadParams = {
  region: ['src/'],
  tests: ['**/*.test.ts'],
  entries: ['src/entry.ts'],
  kinds: ['function', 'const', 'type', 'interface', 'class', 'enum', 'namespace', 'default'],
  published: [],
  aliases: [],
};

const repeated: RepeatedParams = {
  region: ['src/'],
  tests: ['**/*.test.ts'],
  scope: 'exported',
  minMembers: 3,
  minUnion: 3,
  minLiterals: 3,
  ignoreNames: [],
};

let root = '';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const put = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const treeWith = (files: Record<string, string | null>): string => {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) git('rm', '-q', '--cached', '--ignore-unmatch', path);
    else {
      put(path, text);
      git('add', path);
    }
  }
  return git('write-tree');
};

const side = (commit: string, paths: readonly string[] | null): Side => ({
  commit,
  whole: paths === null,
  paths: paths ?? [],
  read: async (path) => {
    try {
      return git('show', `${commit}:${path}`);
    } catch {
      return null;
    }
  },
  facts: null,
});

const wide = 'export type Wide = { readonly a: string; readonly b: string; readonly c: number };\n';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'law-declarations-'));
  git('init', '-q');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('a commit is judged on its changed files over the revision index, and a remeasure over the whole tree finds the same standing violations', async () => {
  const base = treeWith({
    'src/entry.ts': "import { used } from './lib';\nexport const run = () => used();\n",
    'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\n',
    'src/shapes.ts': wide,
    'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => helper();\n",
  });
  const tree = treeWith({
    'src/extra.ts': `export const unused = 1;\n${wide.replace('Wide', 'Copy')}`,
    'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\nexport const added = () => 3;\n',
  });
  const changed = ['src/extra.ts', 'src/lib.ts'];
  const run = programs(root);

  const gatedDead = await run['dead-code']({ params: dead, tree: side(tree, changed), base: side(base, ['src/lib.ts']) });
  expect(gatedDead.tree.covered).toBe('paths');
  expect(gatedDead.tree.findings.map((one) => one.fingerprint)).toEqual(['dead-file src/extra.ts', 'dead src/lib.ts#added']);
  expect(gatedDead.base?.findings.map((one) => one.fingerprint)).toEqual([]);

  const gatedRepeated = await run['repeated-declarations']({
    params: repeated,
    tree: side(tree, changed),
    base: side(base, ['src/lib.ts']),
  });
  expect(gatedRepeated.tree.findings.map((one) => one.path)).toEqual(['src/extra.ts']);
  expect(gatedRepeated.tree.findings[0]?.message).toBe('object type `Copy` {a, b, c} is also declared in src/shapes.ts:1 (`Wide`)');

  const whole = await run['dead-code']({ params: dead, tree: side(tree, null), base: side(base, null) });
  expect(whole.tree.covered).toBe('reach');
  expect(whole.tree.findings.map((one) => one.fingerprint)).toEqual([
    'dead-file src/extra.ts',
    'dead src/lib.ts#added',
    'dead-file src/shapes.ts',
    'dead-file src/user.ts',
  ]);
  expect(whole.base?.findings.map((one) => one.fingerprint)).toEqual(['dead-file src/shapes.ts', 'dead-file src/user.ts']);
});

test('a commit that removes the last import of an export leaves the exporter to the remeasure, which reports it', async () => {
  const before = treeWith({
    'src/entry.ts': "import { helper } from './lib';\nimport { viaUser } from './user';\nexport const run = () => [helper(), viaUser()];\n",
    'src/lib.ts': 'export const helper = () => 2;\n',
    'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => helper();\n",
  });
  const after = treeWith({
    'src/entry.ts': "import { viaUser } from './user';\nexport const run = () => [viaUser()];\n",
    'src/user.ts': 'export const viaUser = () => 0;\n',
  });
  const run = programs(root);
  const gated = await run['dead-code']({
    params: dead,
    tree: side(after, ['src/entry.ts', 'src/user.ts']),
    base: side(before, ['src/entry.ts', 'src/user.ts']),
  });
  expect(gated.tree.findings).toEqual([]);
  const whole = await run['dead-code']({ params: dead, tree: side(after, null), base: null });
  expect(whole.tree.findings.map((one) => one.fingerprint)).toEqual(['dead-file src/lib.ts']);
});

test('a base tree nobody judged before is derived from the nearest indexed tree', async () => {
  treeWith({
    'src/entry.ts': "import { fresh } from './wanted';\nexport const run = () => fresh;\n",
    'src/wanted.ts': 'export const fresh = 1;\n',
  });
  const skipped = treeWith({ 'src/other.ts': 'export const other = 1;\n' });
  const tree = treeWith({ 'src/wanted.ts': 'export const fresh = 1;\nexport const more = 2;\n' });
  const answer = await programs(root)['dead-code']({
    params: dead,
    tree: side(tree, ['src/wanted.ts']),
    base: side(skipped, ['src/wanted.ts']),
  });
  expect(answer.tree.findings.map((one) => one.fingerprint)).toEqual(['dead src/wanted.ts#more']);
  expect(answer.base?.findings).toEqual([]);
});

test('a change outside every judged file costs nothing and finds nothing', async () => {
  const before = treeWith({});
  const after = treeWith({ 'docs/readme.md': 'text\n' });
  const run = programs(root);
  const answer = await run['dead-code']({ params: dead, tree: side(after, ['docs/readme.md']), base: side(before, []) });
  expect(answer.tree.findings).toEqual([]);
});

test('a revision memo keeps JSON values by key across handles', () => {
  saveRevision(root, 'probe/1', { files: 3, nested: ['a'] });
  expect(revisionAt(root, 'probe/1')).toEqual({ files: 3, nested: ['a'] });
  expect(revisionAt(root, 'probe/2')).toBeUndefined();
});
