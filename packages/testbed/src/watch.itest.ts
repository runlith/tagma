import { beforeAll, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE } from './core/run.ts';

const PRELOAD = join(import.meta.dir, 'bun.ts');
const FIXTURE = join(import.meta.dir, 'fixture.ts');
const DAEMON =
  "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid)";
const TREE =
  "const c = require('node:child_process').spawn('/bin/sleep', ['313'], { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid); setInterval(() => {}, 1e9)";

const alive = (pid: number): boolean => {
  const state = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  return state !== '' && !state.startsWith('Z');
};

const plant = (files: Readonly<Record<string, string>>): string => {
  const root = join(process.env['TMPDIR']!, `watch-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
};

type Ran = { readonly output: string; readonly code: number | null; readonly pids: Record<string, number> };

const { GITHUB_ACTIONS: _annotations, ...plain } = process.env;

const bunTest = async (cwd: string, args: readonly string[]): Promise<Ran> => {
  const child = Bun.spawn(['bun', 'test', '--no-orphans', ...args], {
    cwd,
    env: { ...plain, RUNLITH_TEST_REPORT: join(cwd, 'report.jsonl') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  const pids = Object.assign(
    {},
    ...output.split('\n').flatMap((line) => (line.startsWith('{"pid') ? [JSON.parse(line) as Record<string, number>] : [])),
  );
  return { output, code, pids };
};

const blamed = (output: string): string[] =>
  [...new Set([...output.matchAll(/\) {2}from (\S+)/g)].map((match) => match[1]!.split('/').pop()!))].sort();

let shared: Ran;
let serial: Ran;
let tree: Ran;
let hooked: Ran;

const ownWorld = `import { afterAll, beforeAll, describe, test } from 'bun:test';
describe('own world', () => {
  let child: ReturnType<typeof Bun.spawn>;
  beforeAll(() => {
    child = Bun.spawn(['sleep', '319'], { stdout: 'ignore', stderr: 'ignore' });
  });
  afterAll(async () => {
    child.kill();
    await child.exited;
  });
  test('runs beside its world', () => {});
});
`;

beforeAll(async () => {
  const sharedRoot = plant({
    'leaves.itest.ts': `import { test } from 'bun:test';
test('leaves a sleeper', () => {
  const child = Bun.spawn(['sleep', '307'], { stdout: 'ignore', stderr: 'ignore' });
  child.unref();
  console.log(JSON.stringify({ pidLeaves: child.pid }));
});
`,
    'daemon.itest.ts': `import { test } from 'bun:test';
test('leaves a daemon through a helper that exits', async () => {
  const helper = Bun.spawn([process.execPath, '-e', ${JSON.stringify(DAEMON)}], { stdout: 'pipe', stderr: 'ignore' });
  console.log(JSON.stringify({ pidDaemon: Number((await new Response(helper.stdout).text()).trim()) }));
});
`,
    'world.itest.ts': `import { test } from 'bun:test';
import { hold } from ${JSON.stringify(FIXTURE)};
test('a world holds a process that has a child of its own', async () => {
  const world = Bun.spawn(['sh', '-c', '"$0" -e "setInterval(() => {}, 1e9)" & echo $!; wait', process.execPath], { stdout: 'pipe', stderr: 'ignore' });
  world.unref();
  hold(world);
  const reader = world.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  console.log(JSON.stringify({ pidWorld: world.pid, pidChild: Number(new TextDecoder().decode(value).trim()) }));
});
`,
  });
  const serialRoot = plant({
    'a-loads.itest.ts': `import { test } from 'bun:test';
const helper = Bun.spawn([process.execPath, '-e', ${JSON.stringify(DAEMON)}], { stdout: 'pipe', stderr: 'ignore' });
console.log(JSON.stringify({ pidLoad: Number((await new Response(helper.stdout).text()).trim()) }));
test('a daemon was left while the file loaded', () => {});
`,
    'b-group.itest.ts': `import { test } from 'bun:test';
import { spawn } from 'node:child_process';
test('a detached shell leaves a sleeper in its group and exits', async () => {
  const shell = spawn('/bin/sh', ['-c', '/bin/sleep 311 >/dev/null 2>&1 & echo $!'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let text = '';
  for await (const chunk of shell.stdout) text += chunk;
  console.log(JSON.stringify({ pidGroup: Number(text.trim()) }));
});
`,
  });
  const treeRoot = plant({
    'c-tree.itest.ts': `import { test } from 'bun:test';
import { spawn } from 'node:child_process';
test('a leftover keeps a sleeper in a session of its own', async () => {
  const leftover = spawn(process.execPath, ['-e', ${JSON.stringify(TREE)}], { stdio: ['ignore', 'pipe', 'ignore'] });
  leftover.unref();
  let text = '';
  for await (const chunk of leftover.stdout) {
    text += chunk;
    if (text.includes('\\n')) break;
  }
  console.log(JSON.stringify({ pidLeftover: leftover.pid, pidTree: Number(text.trim()) }));
});
`,
  });
  const hookedRoot = plant({ 'c-world.itest.ts': ownWorld, 'd-world.itest.ts': ownWorld });
  [shared, serial, tree, hooked] = await Promise.all([
    bunTest(sharedRoot, ['--parallel=2', '--no-isolate', './leaves.itest.ts', './daemon.itest.ts', './world.itest.ts']),
    bunTest(serialRoot, ['./a-loads.itest.ts', './b-group.itest.ts']),
    bunTest(treeRoot, ['./c-tree.itest.ts']),
    bunTest(hookedRoot, ['./c-world.itest.ts', './d-world.itest.ts']),
  ]);
});

test('in a sequential run, what a file starts in its own beforeAll and ends in its afterAll is no residue of the file before it', () => {
  expect(hooked.code, hooked.output).toBe(0);
});

test('a process a test leaves behind, directly or as a daemon of its helper, fails its own file and is killed', () => {
  expect(shared.code).toBe(1);
  expect(
    { blamed: blamed(shared.output), alive: [shared.pids['pidLeaves']!, shared.pids['pidDaemon']!].map(alive) },
    shared.output,
  ).toEqual({ blamed: ['daemon.itest.ts', 'leaves.itest.ts'], alive: [false, false] });
});

test('a daemon left while the file loads, and a sleeper left in a recorded group, fail their own files', () => {
  expect(serial.code).toBe(1);
  expect({ blamed: blamed(serial.output), alive: [serial.pids['pidLoad']!, serial.pids['pidGroup']!].map(alive) }, serial.output).toEqual({
    blamed: ['a-loads.itest.ts', 'b-group.itest.ts'],
    alive: [false, false],
  });
});

test('a leftover is killed with the descendants it keeps in sessions of their own', () => {
  expect(tree.code).toBe(1);
  expect({ blamed: blamed(tree.output), alive: [tree.pids['pidLeftover']!, tree.pids['pidTree']!].map(alive) }, tree.output).toEqual({
    blamed: ['c-tree.itest.ts'],
    alive: [false, false],
  });
});

test('a world process is not residue at file end and dies with the worker, and what outlives it is swept by the next run', async () => {
  expect(shared.output).toContain('(pass) a world holds a process');
  expect(alive(shared.pids['pidWorld']!)).toBe(false);
  const next = await bunTest(plant({ 'next.itest.ts': "import { test } from 'bun:test';\ntest('next run', () => {});\n" }), [
    './next.itest.ts',
  ]);
  expect(next.code, next.output).toBe(0);
  expect(alive(shared.pids['pidChild']!)).toBe(false);
});

test('a process left in the root of a dead worker is swept by the next run, however its cwd is spelled', async () => {
  const owner = Bun.spawnSync(['true']).pid;
  const root = join(BASE, `${owner}.w1`);
  const cwd = join(root, 'home', 'state');
  mkdirSync(cwd, { recursive: true });
  const sleeper = Bun.spawn(['/bin/sleep', '323'], { cwd, stdout: 'ignore', stderr: 'ignore' });
  sleeper.unref();
  const next = await bunTest(plant({ 'next.itest.ts': "import { test } from 'bun:test';\ntest('next run', () => {});\n" }), [
    './next.itest.ts',
  ]);
  expect(next.code, next.output).toBe(0);
  expect(alive(sleeper.pid)).toBe(false);
  await sleeper.exited;
});
