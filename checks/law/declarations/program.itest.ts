import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Side } from '@runlith/tagma/rules';
import { ProgramAnswer, type ProgramInvocation } from '@tagma/inspection/program';
import { Schema } from 'effect';
import type { DeadParams, RepeatedParams } from './declaration';
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

const wide: DeadParams = { ...dead, region: ['src/', 'pkgs/'] };

const judged = async (
  key: 'dead-code' | 'repeated-declarations',
  base: string,
  tree: string,
  paths: readonly string[],
  params: DeadParams | RepeatedParams = key === 'dead-code' ? dead : repeated,
) => {
  type Reading = { findings: { fingerprint: string; path: string }[]; covered?: string | string[] };
  const run = programs(root)[key] as unknown as (input: unknown) => Promise<{ tree: Reading; base?: Reading }>;
  const commit = await run({ params, tree: side(tree, paths), base: side(base, paths) });
  const entire = await run({ params, tree: side(tree, null), base: side(base, null) });
  const covering = (reading: Reading | undefined, whole: Reading | undefined): Reading | undefined => {
    if (!Array.isArray(reading?.covered)) throw new Error('a commit judgment answers explicit covered paths');
    const covered = new Set(reading.covered);
    return { findings: (whole?.findings ?? []).filter((one) => covered.has(one.path)) };
  };
  const whole = { tree: covering(commit.tree, entire.tree)!, base: covering(commit.base, entire.base) };
  return { commit, whole };
};

const initial = {
  'src/entry.ts': "import { used } from './lib';\nimport { viaUser } from './user';\nexport const run = () => [used(), viaUser()];\n",
  'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\n',
  'src/user.ts': "import { helper } from './lib';\nexport const viaUser = () => helper();\n",
  'src/lib.test.ts': "import { helper } from './lib';\nhelper();\n",
};

const index = async (tree: string, deadParams: DeadParams = dead) => {
  await programs(root)['dead-code']({ params: deadParams, tree: side(tree, null), base: null });
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
  expect(fingerprints(commit.tree)).toEqual(['dead src/lib.ts#helper']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.base)).toEqual([]);
  expect(fingerprints(commit.base)).toEqual(fingerprints(whole.base));
});

test('a commit answers its affected paths only: a standing finding in an unrelated file is neither reported nor covered', async () => {
  const base = treeWith({ ...initial, 'src/stale.ts': 'export const stale = 1;\n' });
  await index(base);
  const tree = treeWith({ 'src/user.ts': 'export const viaUser = () => 0;\n' });
  const { commit, whole } = await judged('dead-code', base, tree, ['src/user.ts']);
  expect(commit.tree.covered).toContain('src/lib.ts');
  expect(commit.tree.covered).not.toContain('src/stale.ts');
  expect(fingerprints(commit.tree)).toEqual(['dead src/lib.ts#helper']);
  expect(fingerprints(commit.base)).toEqual([]);
  expect(fingerprints(whole.tree)).toEqual(['dead src/lib.ts#helper']);
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

const packaged = (exported: Record<string, string>) => ({
  'src/entry.ts': "import { x } from '@acme/a/x';\nimport { y } from '@acme/a/y';\nexport const run = () => [x, y];\n",
  'pkgs/a/package.json': JSON.stringify({ name: '@acme/a', exports: exported }),
  'pkgs/a/src/x.ts': 'export const x = 1;\n',
  'pkgs/a/src/y.ts': 'export const y = 2;\n',
});

test('a package manifest that stops exporting a file makes its unchanged exports dead, as the remeasure finds', async () => {
  const base = treeWith(packaged({ './x': './src/x.ts', './y': './src/y.ts' }));
  await index(base, wide);
  const tree = treeWith({ 'pkgs/a/package.json': JSON.stringify({ name: '@acme/a', exports: { './x': './src/x.ts' } }) });
  const { commit, whole } = await judged('dead-code', base, tree, ['pkgs/a/package.json'], wide);
  expect(commit.tree.covered).toEqual(expect.arrayContaining(['pkgs/a/package.json', 'pkgs/a/src/y.ts']));
  expect(fingerprints(commit.tree)).toEqual(['dead pkgs/a/src/y.ts#y']);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
  expect(fingerprints(commit.base)).toEqual([]);
});

test('a manifest edit that keeps name, exports and entries moves nothing', async () => {
  const base = treeWith(packaged({ './x': './src/x.ts', './y': './src/y.ts' }));
  await index(base, wide);
  const tree = treeWith({
    'pkgs/a/package.json': JSON.stringify({ name: '@acme/a', exports: { './x': './src/x.ts', './y': './src/y.ts' }, version: '2.0.0' }),
  });
  const { commit, whole } = await judged('dead-code', base, tree, ['pkgs/a/package.json'], wide);
  expect(fingerprints(commit.tree)).toEqual([]);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
});

test('two packages sharing a name resolve to the later directory until its manifest goes, then to the earlier one, until that one is renamed', async () => {
  const entry = "import { fromC } from '@acme/dup';\nexport const run = () => fromC;\n";
  const manifest = (name: string) => JSON.stringify({ name, exports: './src/index.ts' });
  const base = treeWith({
    'src/entry.ts': entry,
    'pkgs/a/package.json': manifest('@acme/dup'),
    'pkgs/a/src/index.ts': 'export const fromA = 1;\nexport const fromC = 2;\n',
    'pkgs/c/package.json': manifest('@acme/dup'),
    'pkgs/c/src/index.ts': 'export const fromC = 3;\n',
  });
  await index(base, wide);
  const removed = treeWith({ 'pkgs/c/package.json': null });
  const first = await judged('dead-code', base, removed, ['pkgs/c/package.json'], wide);
  expect(fingerprints(first.commit.base)).toEqual(['dead pkgs/a/src/index.ts#fromA', 'dead pkgs/a/src/index.ts#fromC']);
  expect(fingerprints(first.commit.tree)).toEqual(['dead pkgs/a/src/index.ts#fromA', 'dead pkgs/c/src/index.ts#fromC']);
  expect(fingerprints(first.commit.tree)).toEqual(fingerprints(first.whole.tree));
  expect(fingerprints(first.commit.base)).toEqual(fingerprints(first.whole.base));
  const renamed = treeWith({ 'pkgs/a/package.json': manifest('@acme/other') });
  const second = await judged('dead-code', removed, renamed, ['pkgs/a/package.json'], wide);
  expect(fingerprints(second.commit.tree)).toEqual(fingerprints(second.whole.tree));
  expect(fingerprints(second.commit.base)).toEqual(fingerprints(second.whole.base));
  expect(fingerprints(second.commit.tree)).toEqual(['dead pkgs/a/src/index.ts#fromA', 'dead pkgs/a/src/index.ts#fromC']);
});

test('a manifest that points a package path elsewhere splits two equal types in unchanged files, as the remeasure finds', async () => {
  const page = (row: string) => `${row}\nexport type Page = { readonly items: number; readonly value: Row; readonly next: string };\n`;
  const files = (target: string) => ({
    'pkgs/shared/package.json': JSON.stringify({ name: '@acme/shared', exports: { './row': target } }),
    'pkgs/shared/src/page.ts': page("import type { Row } from './row';"),
    'pkgs/app/src/page.ts': page("import type { Row } from '@acme/shared/row';"),
  });
  const reach: RepeatedParams = { ...repeated, region: ['pkgs/'] };
  const base = treeWith(files('./src/row.ts'));
  await programs(root)['repeated-declarations']({ params: reach, tree: side(base, null), base: null });
  const tree = treeWith(files('./src/elsewhere.ts'));
  const { commit, whole } = await judged('repeated-declarations', base, tree, ['pkgs/shared/package.json'], reach);
  expect(fingerprints(commit.base)?.length).toBe(2);
  expect(fingerprints(commit.tree)).toEqual([]);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
});

test('a glob load that starts matching an unchanged file keeps its exports live, as the remeasure finds', async () => {
  const files = (pattern: string) => ({
    'src/entry.ts': "import { modules } from './loader';\nexport const run = () => modules;\n",
    'src/loader.ts': `export const modules = import.meta.glob('${pattern}');\n`,
    'src/plugins/a.ts': 'export const a = 1;\n',
    'src/plugins/b.ts': 'export const b = 2;\n',
  });
  const base = treeWith(files('./plugins/a*.ts'));
  await index(base);
  const tree = treeWith(files('./plugins/*.ts'));
  const { commit, whole } = await judged('dead-code', base, tree, ['src/loader.ts']);
  expect(fingerprints(commit.base)).toEqual(['dead src/plugins/b.ts#b']);
  expect(fingerprints(commit.tree)).toEqual([]);
  expect(fingerprints(commit.tree)).toEqual(fingerprints(whole.tree));
});

test('a glob load that spans the repository root cannot be judged on a commit and names the remeasure', async () => {
  const base = treeWith({ ...initial, 'src/loader.ts': "export const modules = import.meta.glob('./plugins/*.ts');\n" });
  await index(base);
  const tree = treeWith({ 'src/loader.ts': "export const modules = import.meta.glob('/**/*.ts');\n" });
  await expect(
    programs(root)['dead-code']({ params: dead, tree: side(tree, ['src/loader.ts']), base: side(base, ['src/loader.ts']) }),
  ).rejects.toThrow('check_rules over "all"');
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

test('the production law programme routes both declaration keys through its root entry and answers a whole reading in one process', () => {
  const wideA = 'export type Wide = { readonly a: string; readonly b: string; readonly c: number };\n';
  const tree = treeWith({
    ...initial,
    'src/lib.ts': 'export const used = () => 1;\nexport const helper = () => 2;\nexport const orphan = () => 3;\n',
    'src/a.ts': wideA,
    'src/b.ts': wideA.replace('Wide', 'Copy'),
  });
  const reach = { places: ['src'], files: ['**/*.ts'] };
  const invocation: ProgramInvocation = {
    request: 'declarations',
    checker: join(import.meta.dir, '../programs.ts'),
    root,
    tree,
    base: null,
    keys: [
      { key: 'dead', id: 'dead-code', params: dead, reach },
      { key: 'repeated', id: 'repeated-declarations', params: repeated, reach },
    ],
    sides: [{ side: 'tree', paths: null, files: null }],
  };
  const ran = spawnSync(
    process.execPath,
    ['--no-install', join(import.meta.dir, '../../../apps/tagma/server/src/enforcement/programs/runner.ts'), invocation.checker],
    {
      cwd: root,
      input: JSON.stringify(invocation),
    },
  );
  expect(ran.status).toBe(0);
  const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(ran.stdout.toString()));
  expect(answer.failure).toBeUndefined();
  const of = (key: string) => answer.readings.find((one) => one.key === key)!;
  expect(of('dead').covered).toEqual({ scope: 'reach' });
  expect(of('dead').findings.map((one) => one.fingerprint)).toEqual(['dead src/a.ts#Wide', 'dead src/b.ts#Copy', 'dead src/lib.ts#orphan']);
  expect(of('repeated').findings.map((one) => one.path)).toEqual(['src/a.ts', 'src/b.ts']);
});
