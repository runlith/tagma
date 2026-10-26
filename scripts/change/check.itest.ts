import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Graph } from './graph.ts';
import { Hashes } from './inputs.ts';
import { Records } from './records.ts';

let root: string;
const files = new Map<string, string>([
  ['package.json', JSON.stringify({ workspaces: ['pkg', 'dep', 'other'] })],
  ['pkg/package.json', JSON.stringify({ name: '@sample/pkg', scripts: { test: 'bun test', 'test:vitest': 'vitest run' } })],
  [
    'dep/package.json',
    JSON.stringify({
      name: '@sample/dep',
      exports: {
        './testing': { bun: './src/entry.ts', browser: './src/browser.ts' },
        './built': { bun: './dist/entry.js', browser: './dist/browser.js' },
      },
    }),
  ],
  ['other/package.json', JSON.stringify({ name: '@sample/other' })],
  ['other/src/value.ts', 'export const value = 3;'],
  ['pkg/src/contract.test.ts', "import { value } from '@sample/dep/testing'; export const load = () => import('./dynamic.ts');"],
  ['pkg/src/dynamic.ts', 'export const dynamic = 1;'],
  ['pkg/src/built.test.ts', "import { value } from '@sample/dep/built'; export const answer = value;"],
  ['pkg/src/child.fixture.ts', 'export const child = 1;'],
  ['dep/src/entry.ts', 'export const value = 1;'],
  ['dep/src/browser.ts', 'export const value = 2;'],
  ['dep/fixture.json', '{"value":1}'],
  [
    'pkg.card.md',
    '---\nid: pkg\nfields: {"id":"consumer"}\nsources: [{kind: dir, ref: pkg}]\nedges: [{kind: imports-tests, to: dep}]\n---\n',
  ],
  ['dep.card.md', '---\nid: dep\nfields: {"id":"producer"}\nsources: [{kind: dir, ref: dep}]\n---\n'],
  ['other.card.md', '---\nid: other\nfields: {"id":"other"}\nsources: [{kind: dir, ref: other}]\n---\n'],
]);
const graph = (records?: Records): Graph =>
  new Graph(root, [...files.keys()], ['pkg.card.md', 'dep.card.md', 'other.card.md'], new Map(), records);
const variant = { seed: 0, adapter: 'default', isolated: false };

test('the second change check reuses passing isolated fixtures but reruns failures and external reads', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-results-')));
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'change-external-')));
  try {
    const git = Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout });
    expect(git.exitCode, git.stderr.toString()).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'mixed-results', scripts: { test: 'bun test' } }));
    mkdirSync(join(checkout, '.tagma'));
    writeFileSync(
      join(checkout, '.tagma/module.md'),
      '---\nid: fixture\ntags: ["module"]\nfields: {id: fixture}\nsources: [{kind: dir, ref: ""}]\n---\n',
    );
    const pass = `import { expect, test } from 'bun:test'; test('sum', () => expect(2 + 2).toBe(4));`;
    writeFileSync(join(checkout, 'pass.test.ts'), pass);
    writeFileSync(join(checkout, 'fail.test.ts'), pass.replace('toBe(4)', 'toBe(5)'));
    writeFileSync(
      join(checkout, 'hook.test.ts'),
      `${pass}\nimport { afterAll } from 'bun:test'; afterAll(() => { throw new Error('cleanup failed'); });`,
    );
    writeFileSync(
      join(checkout, 'fixture.itest.ts'),
      `import { expect } from 'bun:test';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect } from ${JSON.stringify(Bun.resolveSync('effect', join(import.meta.dir, '../../packages/testbed')))};
import { it } from ${JSON.stringify(join(import.meta.dir, '../../packages/effect-test/src/testing.ts'))};
import { kind, own, shared } from ${JSON.stringify(join(import.meta.dir, '../../packages/testbed/src/worlds.ts'))};
class Files extends Context.Service<Files, string>()('sample/Files') {}
const files = kind(Files, (_: null, home) => Effect.sync(() => {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'value'), 'world');
  return home;
}));
it.live('reads shared and own worlds and the canonical confined home', () => Effect.gen(function* () {
  for (const home of [yield* shared(files, null), yield* own(files, null, 'checks isolated ownership')]) {
    expect(readFileSync(join(realpathSync(home), 'value'), 'utf8')).toBe('world');
  }
  const path = join(realpathSync(process.env.TMPDIR!), 'value');
  writeFileSync(path, 'confined');
  expect(readFileSync(path, 'utf8')).toBe('confined');
}));`,
    );
    mkdirSync(join(external, 'nested'));
    writeFileSync(join(external, 'direct'), 'direct');
    writeFileSync(join(external, 'dot'), 'dot');
    writeFileSync(
      join(checkout, 'outside.itest.ts'),
      `import { expect, test } from 'bun:test';
import { readFile, readFileSync, symlinkSync } from 'node:fs';
import { readFile as readPromise } from 'node:fs/promises';
import { join } from 'node:path';
test('external targets and failed reads retain their dependency and error channel', async () => {
  const root = process.env.TMPDIR!;
  const external = ${JSON.stringify(external)};
  symlinkSync(join(external, 'direct'), join(root, 'outside'));
  expect(readFileSync(join(root, 'outside'), 'utf8')).toBe('direct');
  symlinkSync(join(external, 'nested'), join(root, 'parent'));
  expect(readFileSync(root + '/parent/../dot', 'utf8')).toBe('dot');
  symlinkSync(join(external, 'missing'), join(root, 'missing'));
  expect(await readPromise(join(root, 'missing')).then(() => 'present', (error) => error.code)).toBe('ENOENT');
  symlinkSync('loop', join(root, 'loop'));
  expect(await readPromise(join(root, 'loop')).then(() => 'read', (error) => error.code)).toBe('ELOOP');
  expect(await new Promise((done) => readFile(join(root, 'loop'), (error) => done(error?.code)))).toBe('ELOOP');
});`,
    );
    const changed = join(checkout, 'changed');
    writeFileSync(changed, 'pass.test.ts\n');
    const results = [];
    const output: string[] = [];
    for (const round of [1, 2]) {
      const report = join(tmpdir(), `change-${crypto.randomUUID()}.json`);
      const run = Bun.spawn(
        ['bun', join(import.meta.dir, 'check.ts'), '--root', checkout, '--full', '--paths-from', changed, '--report', report],
        {
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
      output.push(stdout + stderr);
      expect(code, stdout + stderr).toBe(1);
      expect(existsSync(report), stdout + stderr).toBe(true);
      const result = JSON.parse(readFileSync(report, 'utf8')) as {
        cached: number;
        files: { file: string; action: string }[];
        reports: string;
      };
      const audit = readFileSync(join(result.reports, '0.audit.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { file: string; reason: string });
      for (const name of ['direct', 'dot', 'missing', 'loop'])
        expect(
          audit.some((row) => row.file === 'outside.itest.ts' && row.reason.endsWith(`/${name}`)),
          JSON.stringify({ name, audit, output }),
        ).toBe(true);
      results.push({ round, cached: result.cached, files: result.files.map(({ file, action }) => [file, action]) });
    }
    expect(results, output.join('\n')).toEqual([
      {
        round: 1,
        cached: 0,
        files: [
          ['fail.test.ts', 'run'],
          ['fixture.itest.ts', 'run'],
          ['hook.test.ts', 'run'],
          ['outside.itest.ts', 'run'],
          ['pass.test.ts', 'run'],
        ],
      },
      {
        round: 2,
        cached: 2,
        files: [
          ['fail.test.ts', 'run'],
          ['fixture.itest.ts', 'cache'],
          ['hook.test.ts', 'run'],
          ['outside.itest.ts', 'run'],
          ['pass.test.ts', 'cache'],
        ],
      },
    ]);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
}, 30_000);
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'change-inputs-'));
  for (const [file, text] of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('a producer change reaches consumers through test-only relations', () => {
  const reached = graph().affected(['dep/src/entry.ts']);
  expect([...reached.keys()].sort()).toEqual(['dep', 'pkg']);
  expect(graph().runner('pkg/src/contract.test.ts')).toBe('bun');
});

test('the input graph follows testing exports under both runtimes and dynamic imports', () => {
  const current = graph();
  const selected = current.select(['pkg/src/contract.test.ts'], ['pkg/src/dynamic.ts']);
  expect([...selected.selected.keys()]).toEqual(['pkg/src/contract.test.ts']);
  expect([...current.select(['pkg/src/contract.test.ts'], ['pkg/src/child.fixture.ts']).selected.keys()]).toEqual([
    'pkg/src/contract.test.ts',
  ]);
  const source = current.closure('pkg/src/contract.test.ts');
  expect(source.inputs).toContain('dep/src/entry.ts');
  expect(source.inputs).toContain('dep/src/browser.ts');
  expect(source.inputs).toContain('pkg/src/dynamic.ts');
  expect(source.uncertain).toEqual([]);
});

test('a generated package entry follows its declared source in selection and input hashing', () => {
  const current = new Graph(
    root,
    [...files.keys()],
    ['pkg.card.md', 'dep.card.md', 'other.card.md'],
    new Map([
      ['dep/dist/entry.js', 'dep/src/entry.ts'],
      ['dep/dist/browser.js', 'dep/src/browser.ts'],
    ]),
  );
  const file = 'pkg/src/built.test.ts';
  expect([...current.select([file], ['dep/src/entry.ts']).selected.keys()]).toEqual([file]);
  expect(current.closure(file).inputs).toContain('dep/src/browser.ts');
});

test('a cached import index follows a changed edge rather than reusing its former target', () => {
  const directory = join(root, 'records');
  mkdirSync(directory, { recursive: true });
  const records = new Records(directory);
  const before = graph(records);
  const file = 'pkg/src/contract.test.ts';
  expect([...before.select([file], ['other/src/value.ts']).selected.keys()]).toEqual([]);
  before.save();
  writeFileSync(join(root, 'pkg/src/dynamic.ts'), "import { value } from '../../other/src/value.ts'; export const dynamic = value;");
  expect([...graph(records).select([file], ['other/src/value.ts']).selected.keys()]).toEqual([file]);
});

test('directory links hash their target inputs and terminate when they point back into the package', () => {
  const directory = join(root, 'linked');
  mkdirSync(directory);
  const fixture = join(directory, 'value.json');
  writeFileSync(fixture, '{"value":1}');
  const link = join(root, 'dep/linked');
  symlinkSync('../linked', link, 'dir');
  symlinkSync('../dep', join(directory, 'cycle'), 'dir');
  const missing = join(root, 'dep/missing');
  symlinkSync('../absent', missing, 'dir');
  const key = (): string => new Hashes(graph(), ['bun 1'], variant).of('pkg/src/contract.test.ts').key;
  const before = key();
  expect(key()).toBe(before);
  rmSync(missing);
  symlinkSync('../elsewhere', missing, 'dir');
  const retargeted = key();
  expect(retargeted).not.toBe(before);
  writeFileSync(fixture, '{"value":2}');
  expect(key()).not.toBe(retargeted);
});

test('a reached package fixture, toolchain, seed and adapter each invalidate a passing result', () => {
  const key = (seed = 0, adapter = 'default', git = 'git 1'): string =>
    new Hashes(graph(), ['bun 1', git, 'cargo 1'], { ...variant, seed, adapter }).of('pkg/src/contract.test.ts').key;
  const before = key();
  expect(key()).toBe(before);
  expect(key(1)).not.toBe(before);
  expect(key(0, 'real')).not.toBe(before);
  expect(key(0, 'default', 'git 2')).not.toBe(before);
  writeFileSync(join(root, 'dep/fixture.json'), '{"value":2}');
  expect(key()).not.toBe(before);
  const native = join(root, 'packages/execution-host/native/target/release/execution-holder');
  mkdirSync(dirname(native), { recursive: true });
  writeFileSync(native, 'native binary 1');
  const built = key();
  writeFileSync(native, 'native binary 2');
  expect(key()).not.toBe(built);
});
