import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Graph, type Module } from './graph.ts';
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
]);
const modules: readonly Module[] = [
  { id: 'consumer', paths: ['pkg'], imports: [], tests: ['producer'] },
  { id: 'producer', paths: ['dep'], imports: [], tests: [] },
  { id: 'other', paths: ['other'], imports: [], tests: [] },
];
const graph = (records?: Records): Graph => new Graph(root, [...files.keys()], modules, new Map(), records);
const variant = { seed: 0, adapter: 'default', isolated: false };

const tagmaAnswering = (map: Record<string, unknown>): string => {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'change-tagma-')));
  writeFileSync(join(bin, 'answer.json'), JSON.stringify({ status: 'ok', rows: [], shown: 0, total: 0, map: { problems: [], ...map } }));
  writeFileSync(
    join(bin, 'tagma'),
    `#!/bin/sh\n[ "$1 $2" = "op read_inspections" ] || { echo "unexpected tagma call: $*" >&2; exit 2; }\ncat ${JSON.stringify(join(bin, 'answer.json'))}\n`,
  );
  chmodSync(join(bin, 'tagma'), 0o755);
  return bin;
};

const checking = (checkout: string, tagma: string, ...args: string[]) =>
  Bun.spawn(['bun', join(import.meta.dir, 'check.ts'), '--root', checkout, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PATH: `${tagma}:${process.env['PATH'] ?? ''}` },
  });

test('a checkout whose project keeps its graph outside it selects by the module map Tagma assembles', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-stealth-')));
  const drawn = {
    modules: [
      { id: 'app', territory: ['app/'], entries: [] },
      { id: 'lib', territory: ['lib/'], entries: [] },
    ],
    relations: [{ from: 'app', to: 'lib' }],
    region: ['app/', 'lib/'],
  };
  const tagma = tagmaAnswering(drawn);
  const broken = tagmaAnswering({ ...drawn, problems: ['app names under imports a block that is no module card'] });
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'stealth', workspaces: ['app', 'lib'] }));
    mkdirSync(join(checkout, 'lib'));
    mkdirSync(join(checkout, 'app'));
    writeFileSync(join(checkout, 'app/package.json'), JSON.stringify({ name: '@stealth/app', scripts: { test: 'bun test' } }));
    writeFileSync(join(checkout, 'lib/package.json'), JSON.stringify({ name: '@stealth/lib' }));
    writeFileSync(join(checkout, 'lib/value.ts'), 'export const value = 1;');
    writeFileSync(
      join(checkout, 'app/loads.test.ts'),
      "import { test } from 'bun:test'; const name = './late.ts'; test('loads', async () => { await import(name); });",
    );
    writeFileSync(join(checkout, 'changed'), 'lib/value.ts\n');
    const refused = checking(checkout, broken, '--plan', '--paths-from', join(checkout, 'changed'));
    const [, unread, failed] = await Promise.all([
      new Response(refused.stdout).text(),
      new Response(refused.stderr).text(),
      refused.exited,
    ]);
    expect(failed).toBe(1);
    expect(unread).toContain('app names under imports a block that is no module card');
    const run = checking(checkout, tagma, '--plan', '--paths-from', join(checkout, 'changed'));
    const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(code, stdout + stderr).toBe(0);
    const plan = JSON.parse(stdout) as { selected: { file: string; why: string }[] };
    expect(plan.selected).toEqual([
      expect.objectContaining({ file: 'app/loads.test.ts', why: 'module-card reach covers a nonliteral import' }),
    ]);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(tagma, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});

test('the second change check reuses passing isolated fixtures but reruns failures and external reads', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-results-')));
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'change-external-')));
  const tagma = tagmaAnswering({ modules: [{ id: 'fixture', territory: ['/'], entries: [] }], relations: [], region: ['/'] });
  try {
    const git = Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout });
    expect(git.exitCode, git.stderr.toString()).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'mixed-results', scripts: { test: 'bun test' } }));
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
    writeFileSync(join(external, 'opened'), 'opened');
    writeFileSync(join(external, 'served'), 'served');
    writeFileSync(
      join(checkout, 'outside.itest.ts'),
      `import { expect, test } from 'bun:test';
import { readFile, readFileSync, symlinkSync } from 'node:fs';
import { open, readFile as readPromise } from 'node:fs/promises';
import { join } from 'node:path';
test('external targets and failed reads retain their dependency and error channel', async () => {
  const root = process.env.TMPDIR!;
  const external = ${JSON.stringify(external)};
  const handle = await open(join(external, 'opened'), 'r');
  expect(await handle.readFile('utf8')).toBe('opened');
  await handle.close();
  expect(await new Response(Bun.file(join(external, 'served'))).text()).toBe('served');
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
      const run = checking(checkout, tagma, '--full', '--paths-from', changed, '--report', report);
      const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
      output.push(stdout + stderr);
      expect(code, stdout + stderr).toBe(1);
      expect(existsSync(report), stdout + stderr).toBe(true);
      const result = JSON.parse(readFileSync(report, 'utf8')) as {
        cached: number;
        files: { file: string; action: string }[];
        reports: string;
      };
      const audit = readdirSync(result.reports)
        .filter((name) => name.endsWith('.audit.jsonl'))
        .flatMap((name) => readFileSync(join(result.reports, name), 'utf8').trim().split('\n'))
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { file: string; reason: string });
      for (const name of ['opened', 'served', 'direct', 'dot', 'missing', 'loop'])
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
    rmSync(tagma, { recursive: true, force: true });
  }
});
test('a read through open outside the inputs is audited in every Vitest file a worker runs, not only the first', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-vitest-')));
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'change-opened-')));
  const tagma = tagmaAnswering({ modules: [{ id: 'reads', territory: ['/'], entries: [] }], relations: [], region: ['/'] });
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    symlinkSync(join(import.meta.dir, '../node_modules'), join(checkout, 'node_modules'), 'dir');
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'reads', scripts: { test: 'vitest run' } }));
    writeFileSync(
      join(checkout, 'vitest.config.ts'),
      "export default { test: { include: ['*.test.ts'], isolate: false, setupFiles: ['@runlith/testbed/vitest/setup'] } };",
    );
    writeFileSync(join(external, 'opened'), 'opened');
    for (const name of ['one', 'two'])
      writeFileSync(
        join(checkout, `${name}.test.ts`),
        `import { closeSync, openSync, readSync } from 'node:fs';
import { expect, test } from 'vitest';
test('reads through open', () => {
  const handle = openSync(${JSON.stringify(join(external, 'opened'))}, 'r');
  const bytes = Buffer.alloc(6);
  readSync(handle, bytes);
  closeSync(handle);
  expect(bytes.toString()).toBe('opened');
});
`,
      );
    writeFileSync(join(checkout, 'changed'), 'one.test.ts\n');
    const report = join(external, 'report.json');
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${tagma}:${process.env['PATH'] ?? ''}`,
      TESTBED_CORES: '1',
      TESTBED_BUDGET_ROOT: join(external, 'budget'),
    };
    delete env['RUNLITH_TEST_SLOT'];
    const run = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, 'check.ts'),
        '--root',
        checkout,
        '--full',
        '--no-cache',
        '--paths-from',
        join(checkout, 'changed'),
        '--report',
        report,
      ],
      { stdout: 'pipe', stderr: 'pipe', env },
    );
    const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(code, stdout + stderr).toBe(0);
    const result = JSON.parse(readFileSync(report, 'utf8')) as { reports: string };
    const audited = readFileSync(join(result.reports, '0.audit.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { file: string; reason: string })
      .filter((row) => row.reason.endsWith('/opened'))
      .map((row) => row.file)
      .sort();
    expect(audited, stdout + stderr).toEqual(['one.test.ts', 'two.test.ts']);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
    rmSync(tagma, { recursive: true, force: true });
  }
});
test('the files a change check selects in one package run side by side on the machine budget', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-side-')));
  const marks = realpathSync(mkdtempSync(join(tmpdir(), 'change-marks-')));
  const tagma = tagmaAnswering({ modules: [{ id: 'side', territory: ['/'], entries: [] }], relations: [], region: ['/'] });
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'side', scripts: { test: 'bun test' } }));
    for (const [name, other] of [
      ['one', 'two'],
      ['two', 'one'],
    ] as const)
      writeFileSync(
        join(checkout, `${name}.itest.ts`),
        `import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
test('meets the other file', async () => {
  writeFileSync(${JSON.stringify(join(marks, `${name}.started`))}, '');
  const until = Date.now() + 4000;
  while (!existsSync(${JSON.stringify(join(marks, `${other}.started`))}) && Date.now() < until) await Bun.sleep(20);
  const met = existsSync(${JSON.stringify(join(marks, `${other}.started`))}) && !existsSync(${JSON.stringify(join(marks, `${other}.ended`))});
  await Bun.sleep(300);
  writeFileSync(${JSON.stringify(join(marks, `${name}.ended`))}, '');
  expect(met).toBe(true);
});
`,
      );
    writeFileSync(join(checkout, 'changed'), 'one.itest.ts\n');
    const report = join(marks, 'report.json');
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${tagma}:${process.env['PATH'] ?? ''}`,
      TESTBED_CORES: '12',
      TESTBED_BUDGET_ROOT: join(marks, 'budget'),
    };
    delete env['RUNLITH_TEST_SLOT'];
    const run = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, 'check.ts'),
        '--root',
        checkout,
        '--full',
        '--no-cache',
        '--paths-from',
        join(checkout, 'changed'),
        '--report',
        report,
      ],
      { stdout: 'pipe', stderr: 'pipe', env },
    );
    const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(code, stdout + stderr).toBe(0);
    expect((JSON.parse(readFileSync(report, 'utf8')) as { ran: number }).ran).toBe(2);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(marks, { recursive: true, force: true });
    rmSync(tagma, { recursive: true, force: true });
  }
});
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
  expect([...reached.keys()].sort()).toEqual(['consumer', 'producer']);
  expect(graph().runner('pkg/src/contract.test.ts')).toBe('bun');
});

test('a path belongs to the module of its deepest territory, and a module drawn at the root carries every package', () => {
  const drawn = new Graph(
    root,
    [...files.keys()],
    [
      { id: 'core', paths: ['pkg', 'other/a/very/long/cut.ts'], imports: [], tests: [] },
      { id: 'contract', paths: ['pkg/src'], imports: [], tests: [] },
    ],
  );
  expect(drawn.owner('pkg/src/contract.test.ts')?.id).toBe('contract');
  expect(drawn.owner('pkg/package.json')?.id).toBe('core');
  const whole = new Graph(root, [...files.keys()], [{ id: 'all', paths: [''], imports: [], tests: [] }]);
  expect([...whole.related(['pkg/src/contract.test.ts'])].sort()).toEqual(['', 'dep', 'other', 'pkg']);
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
    modules,
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
