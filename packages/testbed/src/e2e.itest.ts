import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRow } from './core/ledger.ts';
import type { RunRow } from './report.ts';
import { budgetOf, memoryOf, SLOT_ENV } from './slots.ts';

const CLI = join(import.meta.dir, 'cli.ts');
const ENGINE = Bun.resolveSync('@runlith/sqlite-process/engine', import.meta.dir);

const directory = (): string => {
  const root = join(process.env['TMPDIR']!, `e2e-${crypto.randomUUID()}`);
  mkdirSync(root);
  return root;
};

const run = async (cwd: string, args: readonly string[], overrides: Record<string, string | undefined> = {}) => {
  const report = join(cwd, `${crypto.randomUUID()}.jsonl`);
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd,
    env: { ...process.env, ...overrides, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const files = !existsSync(report)
    ? []
    : readFileSync(report, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FileRow)
        .filter((row) => row.type === 'file');
  return { code, output: stdout + stderr, files, report };
};

const names = (files: readonly FileRow[]): string[] => files.map((file) => file.file.split('/').at(-1)!).sort();

const sum = "import { expect, test } from 'bun:test'; test('sum', () => expect(2 + 2).toBe(4));";

type ProgramOutput = { readonly root: string; readonly units: number; readonly args: string[] };

test('stand programs get one e2e family and a run root without loading bun:test', async () => {
  const root = directory();
  writeFileSync(
    join(root, 'bench.ts'),
    `import { writeFileSync } from 'node:fs';
import { runRoot } from ${JSON.stringify(join(import.meta.dir, 'fixture.ts'))};
const root = runRoot();
writeFileSync(root + '/measurement', 'frames');
console.log(JSON.stringify({ root, units: Number(process.env.${SLOT_ENV}.split(':')[2]), args: process.argv.slice(2) }));`,
  );
  for (const cores of [8, 1]) {
    const result = await run(root, ['e2e', '--program', './bench.ts', '--sample', 'frames'], {
      TESTBED_CORES: String(cores),
      TESTBED_BUDGET_ROOT: join(root, 'units'),
      [SLOT_ENV]: undefined,
    });
    expect(result.code, result.output).toBe(0);
    const output = JSON.parse(result.output.split('\n').find((line) => line.startsWith('{'))!) as ProgramOutput;
    expect(output.units).toBe(Math.min(2, budgetOf(cores, memoryOf())));
    expect(output.args).toEqual(['--sample', 'frames']);
    expect(readFileSync(join(output.root, 'measurement'), 'utf8')).toBe('frames');
    const report = readFileSync(result.report, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunRow);
    expect(report).toEqual([expect.objectContaining({ type: 'run', runner: 'other', files: 0, tests: 0 })]);
  }
});

test('ordinary runs isolate e2e files, whose explicit lane permits resources and watches their processes', async () => {
  const root = directory();
  const git = Bun.spawnSync(['git', 'init', '-q', root]);
  expect(git.exitCode, git.stderr.toString()).toBe(0);
  writeFileSync(join(root, '.gitignore'), 'ignored/\n');
  writeFileSync(join(root, 'unit.test.ts'), sum);
  writeFileSync(join(root, 'resource.itest.ts'), sum);
  for (const dir of ['ignored', 'build', 'node_modules']) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, 'hidden.e2e.ts'), "throw new Error('excluded e2e file ran');");
  }
  writeFileSync(
    join(root, 'flow.e2e.ts'),
    `import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCE_ID } from ${JSON.stringify(ENGINE)};
test('resources', async () => {
  const path = process.env.TMPDIR + '/value';
  writeFileSync(path, 'disk');
  expect(readFileSync(path, 'utf8')).toBe('disk');
  const child = Bun.spawn([process.execPath, '-e', "process.stdout.write('child')"], { stdout: 'pipe' });
  expect(await new Response(child.stdout).text()).toBe('child');
  expect(await child.exited).toBe(0);
  const database = new Database(':memory:');
  expect(database.query('SELECT sqlite_source_id() AS source').get()).toEqual({ source: SOURCE_ID });
  database.close();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('loopback') });
  try { expect(await (await fetch(server.url)).text()).toBe('loopback'); }
  finally { await server.stop(true); }
});`,
  );

  const ordinary = await run(root, ['bun', 'test']);
  expect(ordinary.code, ordinary.output).toBe(0);
  expect(names(ordinary.files)).toEqual(['unit.test.ts']);
  const integration = await run(root, ['bun', 'test', './resource.itest.ts']);
  expect(integration.code, integration.output).toBe(0);
  expect(names(integration.files)).toEqual(['resource.itest.ts']);
  const e2e = await run(root, ['e2e', '-t', 'resources']);
  expect(e2e.code, e2e.output).toBe(0);
  expect(e2e.files.map((file) => [file.file.split('/').at(-1), file.kind, file.residue])).toEqual([['flow.e2e.ts', 'e2e', 0]]);
  expect(e2e.files[0]!.children.other.count).toBe(1);

  writeFileSync(
    join(root, 'leaves.e2e.ts'),
    `import { test } from 'bun:test';
test('leaves a child', () => { Bun.spawn(['sleep', '307'], { stdout: 'ignore', stderr: 'ignore' }).unref(); });`,
  );
  const orphan = await run(root, ['e2e', './leaves.e2e.ts']);
  expect(orphan.code, orphan.output).toBe(1);
  expect(names(orphan.files)).toEqual(['leaves.e2e.ts']);
  expect(orphan.files[0]!.residue).toBe(1);
});

test('a kind command runs its own package files of that kind and leaves nested packages to their own runs', async () => {
  const root = directory();
  const git = Bun.spawnSync(['git', 'init', '-q', root]);
  expect(git.exitCode, git.stderr.toString()).toBe(0);
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'unit.test.ts'), sum);
  writeFileSync(join(root, 'own.e2e.ts'), sum);
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'own.itest.ts'), sum);
  for (const dir of ['build', 'nested']) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, 'foreign.itest.ts'), "throw new Error('a foreign itest ran');");
    writeFileSync(join(root, dir, 'foreign.e2e.ts'), "throw new Error('a foreign e2e ran');");
  }
  writeFileSync(join(root, 'nested', 'package.json'), '{}');
  const itest = await run(root, ['itest']);
  expect(itest.code, itest.output).toBe(0);
  expect(names(itest.files)).toEqual(['own.itest.ts']);
  const e2e = await run(root, ['e2e']);
  expect(e2e.code, e2e.output).toBe(0);
  expect(names(e2e.files)).toEqual(['own.e2e.ts']);
});

test('an empty e2e or itest selection fails without falling back to ordinary tests', async () => {
  const root = directory();
  writeFileSync(join(root, 'unit.test.ts'), sum);
  for (const kind of ['e2e', 'itest']) {
    const empty = await run(root, [kind, '--pass-with-no-tests']);
    expect(empty.code, empty.output).toBe(1);
    expect(empty.files).toEqual([]);
  }
});

test('e2e workers retain two budget units each and one on a tiny machine', async () => {
  for (const cores of [8, 1]) {
    const root = directory();
    const budget = budgetOf(cores, memoryOf());
    const quantum = Math.min(2, budget);
    const workers = Math.max(1, Math.floor(budget / quantum));
    for (let index = 0; index < 3; index++)
      writeFileSync(
        join(root, `${index}.e2e.ts`),
        `import { expect, test } from 'bun:test';
import { existsSync, readdirSync, watch, writeFileSync } from 'node:fs';
test('worker allowance', async () => {
  writeFileSync(${JSON.stringify(root)} + '/up-' + process.pid, '');
  await new Promise((resolve) => {
    const ready = () => readdirSync(${JSON.stringify(root)}).filter((file) => file.startsWith('up-')).length >= ${workers};
    const watcher = watch(${JSON.stringify(root)}, () => { if (ready()) { watcher.close(); resolve(); } });
    if (ready()) { watcher.close(); resolve(); }
  });
  expect(Number(process.env.${SLOT_ENV}.split(':')[2])).toBe(${workers * quantum});
});`,
      );
    const command =
      cores === 1 ? ['e2e', '--parallel-delay=0'] : ['bun', 'test', '--parallel-delay=0', './0.e2e.ts', './1.e2e.ts', './2.e2e.ts'];
    const result = await run(root, command, {
      TESTBED_CORES: String(cores),
      TESTBED_BUDGET_ROOT: join(root, 'units'),
      [SLOT_ENV]: undefined,
    });
    expect(result.code, result.output).toBe(0);
    expect(new Set(result.files.map((file) => file.worker)).size).toBe(workers);
    expect(result.files).toHaveLength(3);
  }
});
