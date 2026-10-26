import { expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PRELOAD = join(import.meta.dir, 'bun.ts');
const FIXTURE = join(import.meta.dir, 'fixture.ts');

const root = () => process.env['TMPDIR']!;
const inRoot = (path: string | undefined) => path !== undefined && path.startsWith(`${root()}/`);

const printed = ([command, ...args]: string[]): Promise<string> =>
  new Promise((resolve) => execFile(command!, args, { encoding: 'utf8' }, (_error, stdout) => resolve(stdout)));

const plant = (name: string, body: string): string => {
  const dir = join(root(), `plant-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(join(dir, name), body);
  return dir;
};

test('a resource file lives in a home inside its root, and so do the processes it starts', async () => {
  expect(root()).toContain('/runlith-test/');
  expect(inRoot(homedir())).toBe(true);
  for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'GIT_CONFIG_GLOBAL']) {
    expect(inRoot(process.env[name])).toBe(true);
  }
  expect(await printed(['sh', '-c', 'printf %s "$HOME"'])).toBe(homedir());
});

test('git answers the test identity, not the machine owner', async () => {
  const read = async (key: string) => (await printed(['git', 'config', '--global', key])).trim();
  expect(await read('user.email')).toBe('test@runlith.invalid');
  expect(await read('user.name')).toBe('runlith test');
});

test('a child started through Bun.spawn with no env of its own sees the confined home and the test identity', async () => {
  const shell = Bun.spawn(['sh', '-c', 'printf "%s\\n%s" "$HOME" "$GIT_CONFIG_NOSYSTEM"'], { stdout: 'pipe' });
  expect((await new Response(shell.stdout).text()).split('\n')).toEqual([homedir(), '1']);
  const git = Bun.spawn({ cmd: ['git', 'config', '--global', 'user.email'], stdout: 'pipe' });
  expect((await new Response(git.stdout).text()).trim()).toBe('test@runlith.invalid');
});

test('each repeat owns a fresh confined root and retires it before the next repeat', async () => {
  const dir = plant(
    'repeat.itest.ts',
    `import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
let previous;
test('a repeat has a writable root and confined home', () => {
  const root = process.env.TMPDIR;
  if (previous !== undefined) expect(existsSync(previous)).toBe(false);
  const temp = mkdtempSync(join(root, 'fixture-'));
  writeFileSync(join(temp, 'value'), 'persisted');
  expect(readFileSync(join(temp, 'value'), 'utf8')).toBe('persisted');
  expect(homedir()).toBe(join(root, 'home'));
  console.log(JSON.stringify({ root }));
  previous = root;
});
`,
  );
  const run = Bun.spawn(['bun', 'test', '--parallel=1', '--rerun-each=2', './repeat.itest.ts'], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect({ code, stderr: code === 0 ? '' : stderr }).toEqual({ code: 0, stderr: '' });
  const roots = stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => (JSON.parse(line) as { root: string }).root);
  expect(roots).toHaveLength(2);
  expect(new Set(roots).size).toBe(2);
  expect(roots.map((path) => existsSync(path))).toEqual([false, false]);
}, 30_000);

test("a directory the next file makes while it is imported outlives the previous file's cleanup", async () => {
  const dir = plant('1-first.itest.ts', `import { test } from 'bun:test';\ntest('first', () => {});\n`);
  writeFileSync(
    join(dir, '2-second.itest.ts'),
    `import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const made = mkdtempSync(join(tmpdir(), 'imported-'));
test('second', () => {
  expect(existsSync(made)).toBe(true);
});
`,
  );
  const run = Bun.spawn(['bun', 'test', '--parallel=1', '--no-isolate', './1-first.itest.ts', './2-second.itest.ts'], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([new Response(run.stderr).text(), run.exited]);
  expect({ code, stderr: code === 0 ? '' : stderr }).toEqual({ code: 0, stderr: '' });
}, 30_000);

test('a file whose setup fails before any test is charged no negative world', async () => {
  const dir = plant('1-ran.itest.ts', `import { test } from 'bun:test';\ntest('ran', () => {});\n`);
  writeFileSync(
    join(dir, '2-unready.itest.ts'),
    `import { beforeAll, test } from 'bun:test';\nbeforeAll(() => { throw new Error('setup broke'); });\ntest('never', () => {});\n`,
  );
  writeFileSync(join(dir, '3-ran.itest.ts'), `import { test } from 'bun:test';\ntest('ran', () => {});\n`);
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(['bun', 'test', '--parallel=1', '--no-isolate', './1-ran.itest.ts', './2-unready.itest.ts', './3-ran.itest.ts'], {
    cwd: dir,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await run.exited;
  const files = readFileSync(report, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { type: string; file: string; world: { cpu: number; wall: number } })
    .filter((row) => row.type === 'file');
  expect(files.map((row) => row.file.split('/').at(-1))).toEqual(['1-ran.itest.ts', '2-unready.itest.ts', '3-ran.itest.ts']);
  expect(files.filter((row) => row.world.cpu < 0 || row.world.wall < 0)).toEqual([]);
}, 30_000);

test('the report charges a child to the item it ran in: the body, or the tenant a fixture measured', async () => {
  const dir = plant(
    'burn.itest.ts',
    `import { test } from 'bun:test';
import { measure } from ${JSON.stringify(FIXTURE)};
const burn = () => Number(Bun.spawnSync(['sh', '-c', 'i=0; while [ $i -lt 100000 ]; do i=$((i+1)); done']).resourceUsage.cpuTime.total) / 1000;
test('body', () => { console.log(JSON.stringify({ body: burn() })); });
test('tenant', async () => { const ms = await measure('tenant', burn); console.log(JSON.stringify({ tenant: ms })); });
`,
  );
  const report = join(dir, 'report.jsonl');
  const run = Bun.spawn(['bun', 'test', './burn.itest.ts'], {
    cwd: dir,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  expect(code).toBe(0);
  const child = Object.assign(
    {},
    ...stdout.split('\n').flatMap((line) => (line.startsWith('{') ? [JSON.parse(line) as Record<string, number>] : [])),
  ) as {
    body: number;
    tenant: number;
  };
  const rows = readFileSync(report, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          tenant: { cpu: number };
          body: { cpu: number };
          children?: { other: { count: number; cpu: number } };
        },
    );
  const file = rows.find((row) => row.type === 'file')!;
  expect(file.children!.other.count).toBe(2);
  expect(file.children!.other.cpu).toBeGreaterThanOrEqual(child.body + child.tenant - 1);
  expect(file.tenant.cpu).toBeGreaterThanOrEqual(child.tenant - 1);
  expect(file.body.cpu).toBeGreaterThanOrEqual(child.body - 1);
  expect(file.body.cpu).toBeLessThan(child.body + child.tenant);
}, 30_000);
