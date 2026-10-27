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
import { Graph } from './graph.ts';
import { Hashes } from './inputs.ts';
import { Records } from './records.ts';
import { budgetOf, memoryOf } from '@runlith/testbed/budget';
import { rendezvousSource } from './testing/rendezvous.ts';

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
  [
    'pkg/src/contract.test.ts',
    "import { value } from '@sample/dep/testing'; export const load = () => import('./dynamic.ts'); export const pages = import.meta.glob(['./pages/*.ts', '!./pages/hidden.ts']);",
  ],
  ['pkg/src/pages/shown.ts', 'export const page = 1;'],
  ['pkg/src/pages/hidden.ts', 'export const page = 2;'],
  ['pkg/src/dynamic.ts', 'export const dynamic = 1;'],
  ['pkg/src/built.test.ts', "import { value } from '@sample/dep/built'; export const answer = value;"],
  ['pkg/src/child.fixture.ts', 'export const child = 1;'],
  ['dep/src/entry.ts', 'export const value = 1;'],
  ['dep/src/browser.ts', 'export const value = 2;'],
  ['dep/fixture.json', '{"value":1}'],
]);
const graph = (records?: Records): Graph => new Graph(root, [...files.keys()], new Map(), records);
const variant = { seed: 0, adapter: 'default', isolated: false };

const checking = (checkout: string, ...args: string[]) =>
  Bun.spawn(['bun', join(import.meta.dir, 'check.ts'), '--root', checkout, ...args], { stdout: 'pipe', stderr: 'pipe' });
const ended = async (run: ReturnType<typeof checking>): Promise<{ code: number; stdout: string; stderr: string }> => {
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  return { code, stdout, stderr };
};
const answer = async (run: ReturnType<typeof checking>): Promise<string> => {
  const { code, stdout, stderr } = await ended(run);
  expect(code, stdout + stderr).toBe(0);
  return stdout;
};

test('a nonliteral import selects its tests until their run traces what it loaded or its package declares it, and a load outside the declaration fails the file', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-traced-')));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'traced', workspaces: ['app', 'lib'] }));
    mkdirSync(join(checkout, 'lib'));
    mkdirSync(join(checkout, 'app'));
    writeFileSync(
      join(checkout, 'app/package.json'),
      JSON.stringify({ name: '@traced/app', scripts: { test: 'bun test' }, dependencies: { '@traced/lib': 'workspace:*' } }),
    );
    writeFileSync(
      join(checkout, 'lib/package.json'),
      JSON.stringify({
        name: '@traced/lib',
        exports: { './loader': { bun: './loader.ts' }, './only': { bun: './only.ts' }, './declared': { bun: './declared.ts' } },
        changeCheck: { loads: { 'declared.ts': ['lib/dyn/*.ts'] } },
      }),
    );
    writeFileSync(join(checkout, 'lib/suffix.ts'), "export const suffix = '.ts';");
    const computed = "import { suffix } from './suffix.ts'; export const load = (name: string) => import(`./${name}${suffix}`);";
    writeFileSync(join(checkout, 'lib/loader.ts'), computed);
    writeFileSync(join(checkout, 'lib/declared.ts'), computed);
    mkdirSync(join(checkout, 'lib/dyn'));
    writeFileSync(join(checkout, 'lib/dyn/a.ts'), 'export const a = 1;');
    writeFileSync(join(checkout, 'lib/stray.ts'), 'export const stray = 5;');
    for (const [name, loaded, field, value] of [
      ['declared', 'dyn/a', 'a', 1],
      ['stray', 'stray', 'stray', 5],
    ] as const)
      writeFileSync(
        join(checkout, `app/${name}.test.ts`),
        `import { expect, test } from 'bun:test'; import { load } from '@traced/lib/declared'; test('${name}', async () => { expect((await load('${loaded}')).${field}).toBe(${value}); });`,
      );
    writeFileSync(join(checkout, 'lib/late.ts'), 'export const late = 2;');
    writeFileSync(join(checkout, 'lib/other.ts'), 'export const other = 3;');
    writeFileSync(join(checkout, 'lib/only.ts'), 'export const only = 1;');
    writeFileSync(
      join(checkout, 'app/loads.test.ts'),
      "import { expect, test } from 'bun:test'; import { load } from '@traced/lib/loader'; test('loads', async () => { expect((await load('late')).late).toBe(2); });",
    );
    writeFileSync(
      join(checkout, 'app/only.test.ts'),
      "import { expect, test } from 'bun:test'; import { only } from '@traced/lib/only'; test('only', () => expect(only).toBe(1));",
    );
    writeFileSync(
      join(checkout, 'app/other.test.ts'),
      "import { expect, test } from 'bun:test'; import { other } from '../lib/other.ts'; test('other', () => expect(other).toBe(3));",
    );
    expect(Bun.spawnSync(['bun', 'install'], { cwd: checkout, stdout: 'pipe', stderr: 'pipe' }).exitCode).toBe(0);
    const paths = (name: string, ...changed: string[]): string => {
      writeFileSync(join(checkout, name), `${changed.join('\n')}\n`);
      return join(checkout, name);
    };
    const plan = async (...changed: string[]) =>
      (
        JSON.parse(await answer(checking(checkout, '--plan', '--paths-from', paths('changed', ...changed)))) as {
          selected: { file: string; why: string }[];
        }
      ).selected.map(({ file, why }) => [file, why.split(':')[0]]);
    expect(await plan('lib/other.ts')).toEqual([
      ['app/loads.test.ts', 'reaches a nonliteral import its run has not traced'],
      ['app/other.test.ts', 'import closure reaches a changed input'],
    ]);
    const run = async (): Promise<{ ran: number; cached: number }> => {
      const report = join(checkout, 'report.json');
      await answer(checking(checkout, '--paths-from', paths('ran', 'app/loads.test.ts', 'app/declared.test.ts'), '--report', report));
      return JSON.parse(readFileSync(report, 'utf8')) as { ran: number; cached: number };
    };
    expect(await run()).toMatchObject({ ran: 2, cached: 0 });
    expect(await plan('lib/other.ts')).toEqual([['app/other.test.ts', 'import closure reaches a changed input']]);
    expect(await plan('lib/late.ts')).toEqual([['app/loads.test.ts', 'import closure reaches a changed input']]);
    expect(await plan('lib/dyn/a.ts')).toEqual([
      ['app/declared.test.ts', 'import closure reaches a changed input'],
      ['app/stray.test.ts', 'import closure reaches a changed input'],
    ]);
    expect(await run()).toMatchObject({ ran: 0, cached: 2 });
    const stray = await ended(checking(checkout, '--paths-from', paths('ran', 'app/stray.test.ts')));
    expect(stray.code, stray.stdout + stray.stderr).toBe(1);
    expect(stray.stdout).toContain('lib/declared.ts loaded lib/stray.ts, which changeCheck.loads in lib/package.json does not declare');
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test('a coverage map drops only the candidates whose executed code and load the change leaves alone', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-map-')));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'mapped', scripts: { test: 'bun test' } }));
    const lib =
      'export const LIMIT: number = 3;\nexport const values = [\n  1,\n];\n\nexport function used(x: number): number {\n  return x + 1;\n}\n';
    const other = 'export function rare(x: number): number {\n  return x * 2;\n}\n';
    const reads =
      "import { expect, test } from 'bun:test'; import { LIMIT } from './lib.ts'; import './other.ts'; test('reads', () => expect(LIMIT).toBe(3));";
    writeFileSync(join(checkout, 'lib.ts'), lib);
    writeFileSync(join(checkout, 'other.ts'), other);
    writeFileSync(
      join(checkout, 'calls.test.ts'),
      "import { expect, test } from 'bun:test'; import { used } from './lib.ts'; import './other.ts'; test('calls', () => expect(used(1)).toBe(2));",
    );
    writeFileSync(join(checkout, 'reads.test.ts'), reads);
    const mapped = await ended(Bun.spawn(['bun', join(import.meta.dir, 'map.ts'), '--root', checkout], { stdout: 'pipe', stderr: 'pipe' }));
    expect(mapped.code, mapped.stdout + mapped.stderr).toBe(0);
    const plan = async (...changed: string[]) => {
      writeFileSync(join(checkout, 'changed'), `${changed.join('\n')}\n`);
      const { selected, dropped } = JSON.parse(await answer(checking(checkout, '--plan', '--paths-from', join(checkout, 'changed')))) as {
        selected: { file: string }[];
        dropped: { file: string }[];
      };
      return { selected: selected.map(({ file }) => file), dropped: dropped.map(({ file }) => file) };
    };
    const both = { selected: ['calls.test.ts', 'reads.test.ts'], dropped: [] };
    writeFileSync(join(checkout, 'lib.ts'), lib.replace('x + 1', 'x + 2 - 1'));
    writeFileSync(join(checkout, 'other.ts'), other.replace('x * 2', 'x * 3'));
    expect(await plan('lib.ts')).toEqual({ selected: ['calls.test.ts'], dropped: ['reads.test.ts'] });
    expect(await plan('other.ts')).toEqual({ selected: ['calls.test.ts'], dropped: ['reads.test.ts'] });
    writeFileSync(join(checkout, 'lib.ts'), `// the limit\n${lib.replace(': number = 3', ': 3 | 4 = 3')}`);
    writeFileSync(join(checkout, 'other.ts'), other);
    expect(await plan('lib.ts')).toEqual({ selected: [], dropped: ['calls.test.ts', 'reads.test.ts'] });
    writeFileSync(join(checkout, 'lib.ts'), `${lib}globalThis.dispatchEvent?.(new Event('loaded'));\n`);
    expect(await plan('lib.ts')).toEqual(both);
    writeFileSync(join(checkout, 'lib.ts'), lib.replace('  1,\n', '  1,\n  2,\n'));
    expect(await plan('lib.ts')).toEqual(both);
    writeFileSync(join(checkout, 'reads.test.ts'), reads.replace("import './other.ts';", "import { used } from './lib.ts'; used(0);"));
    writeFileSync(join(checkout, 'lib.ts'), lib.replace('x + 1', 'x + 2 - 1'));
    expect(await plan('lib.ts')).toEqual(both);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test('inside a Tagma session the change is what the session holds in this checkout, and an unfinished judgement refuses', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-session-')));
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'change-tagma-')));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'session', scripts: { test: 'bun test' } }));
    const page = (state: object) => ({
      status: 'ok',
      subject: 'thread-a',
      checkouts: [
        {
          checkout: 'root-a',
          root: checkout,
          state,
          entries: [
            { section: 'uncommitted', path: 'moved.ts', from: 'old.ts' },
            { section: 'outside', path: 'ignored.log', from: null },
          ],
        },
        {
          checkout: 'root-b',
          root: bin,
          state: { kind: 'current' },
          entries: [{ section: 'uncommitted', path: 'elsewhere.ts', from: null }],
        },
      ],
      unattributed: [],
      next: 'second',
    });
    const second = {
      status: 'ok',
      checkouts: [],
      unattributed: [
        { checkout: 'root-a', path: 'written.ts' },
        { checkout: 'root-b', path: 'other.ts' },
      ],
      next: null,
    };
    writeFileSync(join(bin, 'second.json'), JSON.stringify(second));
    const tagma = (first: object): void => {
      writeFileSync(join(bin, 'first.json'), JSON.stringify(first));
      writeFileSync(
        join(bin, 'tagma'),
        `#!/bin/sh\n[ "$1 $2" = "op read_changes" ] || exit 2\ncase "$3" in *cursor*) cat ${JSON.stringify(join(bin, 'second.json'))};; *) cat ${JSON.stringify(join(bin, 'first.json'))};; esac\n`,
      );
      chmodSync(join(bin, 'tagma'), 0o755);
    };
    const planned = () =>
      ended(
        Bun.spawn(['bun', join(import.meta.dir, 'check.ts'), '--root', checkout, '--plan'], {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, TAGMA_SESSION_GRANT: 'grant', PATH: `${bin}:${process.env['PATH'] ?? ''}` },
        }),
      );
    tagma(page({ kind: 'current' }));
    const held = await planned();
    expect(held.code, held.stdout + held.stderr).toBe(0);
    expect(JSON.parse(held.stdout)).toMatchObject({ base: 'lines session thread-a holds', changed: ['moved.ts', 'old.ts', 'written.ts'] });
    tagma(page({ kind: 'judging', paths: 3 }));
    const judging = await planned();
    expect(judging.code).toBe(1);
    expect(judging.stderr).toContain('Tagma has not finished judging');
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('the second change check reuses passing isolated fixtures but reruns failures and external reads', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-results-')));
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'change-external-')));
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
      const run = checking(checkout, '--full', '--paths-from', changed, '--report', report);
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
  }
});
test('an environment-skipped file reports why it did not run without failing or becoming reusable, while a real failure still fails', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'change-skipped-')));
  const checkout = join(directory, 'repo');
  mkdirSync(checkout);
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'environment-skip', scripts: { test: 'bun test' } }));
    writeFileSync(
      join(checkout, 'skip.itest.ts'),
      "import { describe, test } from 'bun:test'; describe('Docker work', () => test.skip('requires a running Docker engine', () => {}));",
    );
    writeFileSync(join(checkout, 'fail.itest.ts'), "import { expect, test } from 'bun:test'; test('failure', () => expect(1).toBe(2));");
    const changed = join(directory, 'changed');
    const report = join(directory, 'report.json');
    writeFileSync(changed, 'skip.itest.ts\n');
    for (const round of [1, 2]) {
      const { code, stdout, stderr } = await ended(checking(checkout, '--paths-from', changed, '--report', report));
      expect(code, `round ${round}\n${stdout}${stderr}`).toBe(0);
      expect(stdout).toContain('not run skip.itest.ts: Docker work > requires a running Docker engine');
      expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ selected: 1, ran: 0, cached: 0, skipped: 1 });
    }
    const failed = await ended(checking(checkout, '--full', '--paths-from', changed));
    expect(failed.code, failed.stdout + failed.stderr).toBe(1);
    expect(failed.stdout).toContain('not run skip.itest.ts: Docker work > requires a running Docker engine');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a read through open outside the inputs is audited in every Vitest file a worker runs, not only the first', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-vitest-')));
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'change-opened-')));
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
  }
});
test('the files a change check selects in one package run side by side on the machine budget', async () => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'change-side-')));
  const marks = realpathSync(mkdtempSync(join(tmpdir(), 'change-marks-')));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: checkout }).exitCode).toBe(0);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'side', scripts: { test: 'bun test' } }));
    for (const [name, other] of [
      ['one', 'two'],
      ['two', 'one'],
    ] as const)
      writeFileSync(join(checkout, `${name}.itest.ts`), rendezvousSource(marks, name, other));
    writeFileSync(join(checkout, 'changed'), 'one.itest.ts\n');
    const report = join(marks, 'report.json');
    const env: Record<string, string | undefined> = {
      ...process.env,
      TESTBED_CORES: '12',
      TESTBED_BUDGET_ROOT: join(marks, 'budget'),
      MEET: budgetOf(12, memoryOf()) > 1 ? '1' : '0',
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

test('the input graph follows testing exports under both runtimes, dynamic imports and import globs', () => {
  const current = graph();
  const selected = current.select(['pkg/src/contract.test.ts'], ['pkg/src/dynamic.ts']);
  expect([...selected.selected.keys()]).toEqual(['pkg/src/contract.test.ts']);
  expect(current.closure('pkg/src/contract.test.ts').inputs).toContain('pkg/src/pages/shown.ts');
  expect(current.closure('pkg/src/contract.test.ts').inputs).not.toContain('pkg/src/pages/hidden.ts');
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
