import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileVerdict, SlowRow } from './report.ts';
import { machineBudget } from './slots.ts';

const PRELOAD = join(import.meta.dir, 'bun.ts');
const CLI = join(import.meta.dir, 'cli.ts');
const VITEST = join(dirname(Bun.resolveSync('vitest/package.json', import.meta.dir)), 'vitest.mjs');

test('Vitest workers follow the processes testbed got, and a command-line worker count caps them', async () => {
  const root = join(process.env['TMPDIR']!, `workers-${crypto.randomUUID()}`);
  mkdirSync(root);
  const budget = join(root, 'budget.json');
  writeFileSync(
    join(root, 'budget.mjs'),
    `import { writeFileSync } from 'node:fs';
export default class {
  onInit(core) { this.core = core; }
  onTestRunEnd() { writeFileSync(${JSON.stringify(budget)}, JSON.stringify({ root: this.core.config.maxWorkers, projects: this.core.projects.map(project => project.config.maxWorkers ?? null) })); }
}`,
  );
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: {
    globals: true, include: ['sample.test.js'], reporters: ['./budget.mjs'],
    setupFiles: [${JSON.stringify(join(import.meta.dir, 'vitest/setup.ts'))}],
    globalSetup: [${JSON.stringify(join(import.meta.dir, 'vitest/global.ts'))}],
    projects: [{ extends: true, test: { name: 'unit' } }]
  } };`,
  );
  writeFileSync(join(root, 'sample.test.js'), "test('sum', () => expect(2 + 2).toBe(4));");
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        test: `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} ${JSON.stringify(process.execPath)} --bun ${JSON.stringify(VITEST)} run --config ./vitest.config.mjs`,
      },
    }),
  );
  const env: Record<string, string | undefined> = {
    ...process.env,
    TESTBED_CORES: '5',
    CI: undefined,
    TESTBED_BUDGET_ROOT: join(root, 'units'),
  };
  delete env['RUNLITH_TEST_SLOT'];
  for (const [override, expected] of [
    [undefined, machineBudget({ TESTBED_CORES: '5' })],
    [1, 1],
  ] as const) {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', './sample.test.js', ...(override === undefined ? [] : [`--maxWorkers=${override}`])],
      { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...env, RUNLITH_TEST_REPORT: join(root, `run-${override}.jsonl`) } },
    );
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stdout + stderr).toBe(0);
    const resolved = JSON.parse(readFileSync(budget, 'utf8')) as { root: number; projects: (number | null)[] };
    expect(resolved.root).toBe(expected);
    expect(resolved.projects).toHaveLength(1);
    expect(resolved.projects.every((value) => value === null || value === expected)).toBe(true);
  }
});

test('e2e preserves an explicit split randomization seed', async () => {
  const dir = join(process.env['TMPDIR']!, `seed-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'sample.e2e.ts'), "import { test } from 'bun:test'; test('page-mid-fling', () => {});");
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(
    [process.execPath, CLI, 'e2e', './sample.e2e.ts', '--test-name-pattern', 'page-mid-fling', '--randomize', '--seed', '1'],
    {
      cwd: dir,
      env: { ...process.env, RUNLITH_TEST_REPORT: report },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect(code, stdout + stderr).toBe(0);
  const row = readFileSync(report, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; seed?: number; command?: string })
    .find((entry) => entry.type === 'run');
  expect(row?.seed).toBe(1);
  expect(row?.command?.match(/--seed(?:=|\s+)/g)).toHaveLength(1);
});

test('the run report names a nested test as the runner prints it, outer describe first', async () => {
  const dir = join(process.env['TMPDIR']!, `plant-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(
    join(dir, 'nested.test.ts'),
    `import { describe, test } from 'bun:test';
describe('outer', () => {
  describe('inner', () => {
    test('leaf', () => {});
  });
  test('top', () => {});
});
`,
  );
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(['bun', CLI, 'bun', 'test', './nested.test.ts'], {
    cwd: dir,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([new Response(run.stderr).text(), run.exited]);
  expect({ code, stderr: code === 0 ? '' : stderr }).toEqual({ code: 0, stderr: '' });
  const names = readFileSync(report, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { type: string; name?: string })
    .filter((row) => row.type === 'outcome')
    .map((row) => row.name);
  expect(names.sort()).toEqual(['outer > inner > leaf', 'outer > top']);
});

const slowRows = (report: string): SlowRow[] =>
  readFileSync(report, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SlowRow)
    .filter((row) => row.type === 'slow');

test('a Bun test slower than the runner default passes in a later file of the worker and is reported slow with its outcome', async () => {
  const dir = join(process.env['TMPDIR']!, `slow-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(join(dir, 'a.test.ts'), `import { expect, test } from 'bun:test';\ntest('first', () => expect(2 + 2).toBe(4));\n`);
  writeFileSync(
    join(dir, 'b.test.ts'),
    `import { expect, test } from 'bun:test';
test('waits past the runner default', async () => {
  await new Promise((done) => setTimeout(done, 5_200));
  expect(2 + 2).toBe(4);
});
`,
  );
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(['bun', CLI, 'bun', 'test', '--parallel=1', '--no-isolate', './a.test.ts', './b.test.ts'], {
    cwd: dir,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect(code, stdout + stderr).toBe(0);
  expect(slowRows(report), stdout + stderr).toEqual([
    expect.objectContaining({ name: 'waits past the runner default', outcome: 'pass', over: 1_000 }),
  ]);
  expect(stderr).toContain('slow tests, over 1.0 s unit or 10.0 s integration: 1');
});

test('a slow Vitest test is reported with the outcome Vitest gave it', async () => {
  const root = join(process.env['TMPDIR']!, `slow-vitest-${crypto.randomUUID()}`);
  mkdirSync(root);
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { globals: true, include: ['slow.test.js'], setupFiles: [${JSON.stringify(join(import.meta.dir, 'vitest/setup.ts'))}] } };`,
  );
  writeFileSync(
    join(root, 'slow.test.js'),
    "test('waits past a second', async () => { await new Promise((done) => setTimeout(done, 1_200)); expect(2 + 2).toBe(4); });",
  );
  const report = join(root, 'report.jsonl');
  const env: Record<string, string | undefined> = { ...process.env, RUNLITH_TEST_REPORT: report, TESTBED_BUDGET_ROOT: join(root, 'units') };
  delete env['RUNLITH_TEST_SLOT'];
  const run = Bun.spawn([process.execPath, CLI, process.execPath, '--bun', VITEST, 'run', '--config', './vitest.config.mjs'], {
    cwd: root,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect(code, stdout + stderr).toBe(0);
  expect(slowRows(report), stdout + stderr).toEqual([expect.objectContaining({ name: 'waits past a second', outcome: 'pass' })]);
});

test('the report distinguishes a passing file from a body failure and a cleanup failure in the same run', async () => {
  const dir = join(process.env['TMPDIR']!, `verdicts-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  const pass = `import { expect, test } from 'bun:test'; test('sum', () => expect(2 + 2).toBe(4));`;
  writeFileSync(join(dir, 'pass.test.ts'), pass);
  writeFileSync(join(dir, 'fail.test.ts'), pass.replace('toBe(4)', 'toBe(5)'));
  writeFileSync(
    join(dir, 'hook.test.ts'),
    `${pass}\nimport { afterAll } from 'bun:test'; afterAll(() => { throw new Error('cleanup failed'); });`,
  );
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(['bun', CLI, 'bun', 'test', '--parallel=1', '--no-isolate', './pass.test.ts', './fail.test.ts', './hook.test.ts'], {
    cwd: dir,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect(code, stdout + stderr).toBe(1);
  const verdicts = readFileSync(report, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FileVerdict)
    .filter((row) => row.type === 'file-verdict')
    .map((row) => [row.file.split('/').at(-1), row.outcome])
    .sort();
  expect(verdicts, stdout + stderr).toEqual([
    ['fail.test.ts', 'fail'],
    ['hook.test.ts', 'fail'],
    ['pass.test.ts', 'pass'],
  ]);
});
