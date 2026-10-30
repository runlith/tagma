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
  aliases: [],
};

let root = '';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const treeWith = (files: Record<string, string | null>): string => {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) git('rm', '-q', '--cached', '--ignore-unmatch', path);
    else {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
      git('add', path);
    }
  }
  return git('write-tree');
};

const side = (commit: string, paths: readonly string[] | null): Side => ({
  commit,
  whole: paths === null,
  paths: paths ?? [],
  read: async () => null,
  facts: null,
});

const fingerprints = (answer: { readonly findings: readonly { readonly fingerprint: string }[] } | undefined) =>
  answer?.findings.map((one) => one.fingerprint).sort();

const judged = async (key: 'dead-code' | 'repeated-declarations', base: string, tree: string, paths: readonly string[]) => {
  const run = programs(root)[key] as unknown as (
    input: unknown,
  ) => Promise<{ tree: { findings: { fingerprint: string }[]; covered?: string }; base?: { findings: { fingerprint: string }[] } }>;
  const params = key === 'dead-code' ? dead : repeated;
  const commit = await run({ params, tree: side(tree, paths), base: side(base, paths) });
  const whole = await run({ params, tree: side(tree, null), base: side(base, null) });
  return { commit, whole };
};

const initial = {
  'src/entry.ts': "import { used } from './lib';\nimport { viaUser } from './user';\nexport const run = () => [used(), viaUser()];\n",
  'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\n',
  'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => helper();\n",
  'src/lib.test.ts': "import { helper } from './lib';\nhelper();\n",
};

const index = async (tree: string) => {
  await programs(root)['dead-code']({ params: dead, tree: side(tree, null), base: null });
  await programs(root)['repeated-declarations']({ params: repeated, tree: side(tree, null), base: null });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'law-declarations-'));
  git('init', '-q');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('a commit that removes the last production importer of an export in another file reports the unchanged exporter, as the remeasure does', async () => {
  const base = treeWith(initial);
  await index(base);
  const tree = treeWith({ 'src/user.ts': 'export const viaUser = () => 0;\n' });
  const { commit, whole } = await judged('dead-code', base, tree, ['src/user.ts']);
  expect(commit.tree.covered).toBe('reach');
  expect(fingerprints(commit.tree)).toEqual(['dead src/lib.ts#helper']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.base)).toEqual([]);
  expect(fingerprints(commit.base)).toEqual(fingerprints(whole.base));
});

test('an importer rewritten without dropping its import keeps the export live although the index still holds its older text', async () => {
  const base = treeWith(initial);
  await index(base);
  const rewritten = treeWith({ 'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => [helper(), 1];\n" });
  const next = treeWith({ 'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => [helper(), 2];\n" });
  for (const [before, after] of [
    [base, rewritten],
    [rewritten, next],
  ] as const) {
    const { commit, whole } = await judged('dead-code', before, after, ['src/user.ts']);
    expect(fingerprints(commit.tree)).toEqual([]);
    expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  }
});

test('a commit that adds an unused export, an unused function and a type-only function import reports exactly what the remeasure reports', async () => {
  const base = treeWith(initial);
  await index(base);
  const tree = treeWith({
    'src/lib.ts':
      'export const used = () => 1;\nexport const helper = () => 2;\nexport const added = () => 3;\nexport const typed = () => 4;\n',
    'src/user.ts': "import { helper, type typed } from './lib';\nexport const viaUser = (value?: typed) => helper();\n",
  });
  const { commit, whole } = await judged('dead-code', base, tree, ['src/lib.ts', 'src/user.ts']);
  expect(fingerprints(commit.tree)).toEqual(['dead src/lib.ts#added', 'dead src/lib.ts#typed']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.base)).toEqual(fingerprints(whole.base));
});

test('a surviving test importer does not keep an export alive after its last production importer goes', async () => {
  const base = treeWith(initial);
  await index(base);
  const tree = treeWith({ 'src/user.ts': null, 'src/entry.ts': "import { used } from './lib';\nexport const run = () => used();\n" });
  const { commit, whole } = await judged('dead-code', base, tree, ['src/user.ts', 'src/entry.ts']);
  expect(fingerprints(commit.tree)).toEqual(['dead src/lib.ts#helper']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
});

test('a commit that adds a second copy of a declaration reports the older copy in an untouched file too', async () => {
  const wide = 'export type Wide = { readonly a: string; readonly b: string; readonly c: number };\n';
  const base = treeWith({ ...initial, 'src/shapes.ts': wide });
  await index(base);
  const tree = treeWith({ 'src/copy.ts': wide.replace('Wide', 'Copy') });
  const { commit, whole } = await judged('repeated-declarations', base, tree, ['src/copy.ts']);
  expect(commit.tree.findings.map((one) => one.fingerprint.split(' ')[2])).toEqual(['src/copy.ts', 'src/shapes.ts']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.base)).toEqual([]);
});

test('a base nobody judged before is derived from the nearest indexed tree; with no indexed tree the judgment asks for the whole setup', async () => {
  const first = treeWith(initial);
  const skipped = treeWith({ 'src/other.ts': 'export const other = 1;\n' });
  const tree = treeWith({ 'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\nexport const more = () => 3;\n' });
  await expect(
    programs(root)['dead-code']({ params: dead, tree: side(tree, ['src/lib.ts']), base: side(skipped, ['src/lib.ts']) }),
  ).rejects.toThrow('the declaration index holds no revision');
  await index(first);
  const { commit, whole } = await judged('dead-code', skipped, tree, ['src/lib.ts']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.tree)).toContain('dead src/lib.ts#more');
});

test('a change outside every production file costs nothing and finds nothing', async () => {
  const before = treeWith(initial);
  const after = treeWith({ 'docs/readme.md': 'text\n', 'src/lib.test.ts': 'export {};\n' });
  const answer = await programs(root)['dead-code']({
    params: dead,
    tree: side(after, ['docs/readme.md', 'src/lib.test.ts']),
    base: side(before, []),
  });
  expect(answer.tree.findings).toEqual([]);
});

test('a revision memo keeps JSON values by key across handles', () => {
  saveRevision(root, 'probe/1', { files: 3, nested: ['a'] });
  expect(revisionAt(root, 'probe/1')).toEqual({ files: 3, nested: ['a'] });
  expect(revisionAt(root, 'probe/2')).toBeUndefined();
});
