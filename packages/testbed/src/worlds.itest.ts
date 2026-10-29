import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRow, RefusalRow, WorldRow } from './core/ledger.ts';
import type { FileVerdict } from './report.ts';

const PRELOAD = join(import.meta.dir, 'bun.ts');
const WORLDS = join(import.meta.dir, 'worlds.ts');
const CLI = join(import.meta.dir, 'cli.ts');
const LAYERS = join(import.meta.dir, '../../effect-test/src/testing.ts');
const EFFECT = Bun.resolveSync('effect', import.meta.dir);

const KINDS = `import { Context, Effect } from ${JSON.stringify(EFFECT)};
import { appendFileSync } from 'node:fs';
import { kind } from ${JSON.stringify(WORLDS)};
export class Sleeper extends Context.Service<Sleeper, { readonly pid: number }>()('test/Sleeper') {}
export const sleeper = kind(Sleeper, (_: null) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        appendFileSync(process.env.WORLD_BUILDS!, 'built\\n');
        const child = Bun.spawn(['sleep', '317'], { stdout: 'ignore', stderr: 'ignore' });
        child.unref();
        return child;
      }),
      (child) => Effect.promise(async () => { child.kill(); await child.exited; }),
    ),
    (child) => ({ pid: child.pid }),
  ),
);
const resting = (seconds: string) =>
  Effect.sync(() => {
    const child = Bun.spawn(['sleep', seconds], { stdout: 'ignore', stderr: 'ignore' });
    child.unref();
    return { pid: child.pid };
  });
export class Early extends Context.Service<Early, { readonly pid: number }>()('test/Early') {}
export const early = kind(Early, (_: null) => resting('318'));
export class Late extends Context.Service<Late, { readonly pid: number }>()('test/Late') {}
export const late = kind(Late, (_: null) => resting('319'));
export class Broken extends Context.Service<Broken, { readonly never: true }>()('test/Broken') {}
export const broken = kind(Broken, (_: null) =>
  Effect.flatMap(Effect.acquireRelease(Effect.void, () => Effect.die(new Error('cleanup broke'))), () => Effect.fail('build broke')),
);
`;

const said = (file: string, world: string) => `console.log(JSON.stringify({ file: '${file}', worker: process.pid, world: ${world} }))`;

const FILES: Readonly<Record<string, string>> = {
  '1-own.itest.ts': `import { layer } from ${JSON.stringify(LAYERS)};
import { Effect } from ${JSON.stringify(EFFECT)};
import { world } from ${JSON.stringify(WORLDS)};
import { Sleeper, sleeper } from './kinds.ts';
layer(world(sleeper, null, { own: 'it kills the sleeper' }), { excludeTestServices: true })('own', (it) => {
  it.effect('takes its own world', () => Effect.map(Sleeper, ({ pid }) => ${said('own', 'pid')}));
});
`,
  '2-open.itest.ts': `import { test } from 'bun:test';
import { open } from ${JSON.stringify(WORLDS)};
import { sleeper } from './kinds.ts';
test('takes the shared world by await', async () => {
  const { pid } = await open(sleeper, null);
  ${said('open', 'pid')};
});
`,
  '3-layer.itest.ts': `import { layer } from ${JSON.stringify(LAYERS)};
import { Effect } from ${JSON.stringify(EFFECT)};
import { world } from ${JSON.stringify(WORLDS)};
import { Sleeper, sleeper } from './kinds.ts';
layer(world(sleeper, null), { excludeTestServices: true })('shared', (it) => {
  it.effect('takes the shared world as a layer', () => Effect.map(Sleeper, ({ pid }) => ${said('layer', 'pid')}));
});
`,
  '4-broken.itest.ts': `import { test } from 'bun:test';
import { open } from ${JSON.stringify(WORLDS)};
import { broken } from './kinds.ts';
test('a build that fails and whose cleanup dies answers every waiter', async () => {
  const answers = await Promise.allSettled([open(broken, null), open(broken, null)]);
  ${said('broken', "answers.filter((answer) => answer.status === 'rejected').length")};
});
`,
  '5-reaper.itest.ts': `import { test } from 'bun:test';
import { open } from ${JSON.stringify(WORLDS)};
import { early, late } from './kinds.ts';
test('a world built after its worker lost the reaper still ends with the run', async () => {
  const first = await open(early, null);
  const listed = Bun.spawnSync(['ps', '-A', '-o', 'pid=,ppid=,command=']).stdout.toString();
  for (const line of listed.split('\\n')) {
    const [pid, ppid, ...command] = line.trim().split(/\\s+/);
    if (Number(ppid) === process.pid && command.join(' ').startsWith('/bin/sh -c set -f')) process.kill(Number(pid), 'SIGKILL');
  }
  const { pid } = await open(late, null);
  ${said('early', 'first.pid')};
  ${said('late', 'pid')};
});
`,
};

type Said = { readonly file: string; readonly worker: number; readonly world: number };

const alive = (pid: number): boolean => {
  const state = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  return state !== '' && !state.startsWith('Z');
};

test('a later file owns the world and processes its layer hook builds before its first test', async () => {
  const root = join(process.env['TMPDIR']!, `handoff-${crypto.randomUUID()}`);
  mkdirSync(root);
  writeFileSync(join(root, 'kinds.ts'), KINDS);
  writeFileSync(join(root, 'builds'), '');
  writeFileSync(
    join(root, 'first.itest.ts'),
    `import { expect } from 'bun:test';
import { layer } from ${JSON.stringify(LAYERS)};
import { Effect, Layer } from ${JSON.stringify(EFFECT)};
layer(Layer.empty)('first', (it) => {
  it.effect('warms the layer helper', () => Effect.sync(() => expect(2 + 2).toBe(4)));
});
`,
  );
  writeFileSync(
    join(root, 'second.itest.ts'),
    `import { expect } from 'bun:test';
import { layer } from ${JSON.stringify(LAYERS)};
import { Effect } from ${JSON.stringify(EFFECT)};
import { world } from ${JSON.stringify(WORLDS)};
import { Sleeper, sleeper } from './kinds.ts';
layer(world(sleeper, null, { own: 'it owns the sleeper' }), { excludeTestServices: true })('second', (it) => {
  it.effect('uses the process its own setup built', () => Effect.map(Sleeper, ({ pid }) => expect(process.kill(pid, 0)).toBe(true)));
});
`,
  );
  const report = join(root, 'report.jsonl');
  const child = Bun.spawn(['bun', CLI, 'bun', 'test', '--no-isolate', '--parallel=1', './first.itest.ts', './second.itest.ts'], {
    cwd: root,
    env: { ...process.env, WORLD_BUILDS: join(root, 'builds'), RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  expect(code, output).toBe(0);
  const rows = readFileSync(report, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FileRow | WorldRow | FileVerdict);
  const worlds = rows.filter((row): row is WorldRow => row.type === 'world');
  const files = rows.filter((row): row is FileRow => row.type === 'file');
  expect(worlds.map((row) => [row.file.split('/').at(-1), row.own])).toEqual([['second.itest.ts', 'it owns the sleeper']]);
  expect(files.map((row) => [row.file.split('/').at(-1), row.residue, row.children.other.count])).toEqual([
    ['first.itest.ts', 0, 0],
    ['second.itest.ts', 0, 1],
  ]);
  expect(files[1]!.world.cpu).toBeGreaterThanOrEqual(worlds[0]!.cost.cpu - 0.1);
  expect(rows.filter((row) => row.type === 'file-verdict').map((row) => [row.file.split('/').at(-1), row.outcome])).toEqual([
    ['first.itest.ts', 'pass'],
    ['second.itest.ts', 'pass'],
  ]);
});

test('an isolated file that rebuilds a shared world builds it in a home of its own', async () => {
  const root = join(process.env['TMPDIR']!, `isolated-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(
    join(root, 'fresh.ts'),
    `import { Context, Effect } from ${JSON.stringify(EFFECT)};
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kind } from ${JSON.stringify(WORLDS)};
export class Fresh extends Context.Service<Fresh, { readonly home: string }>()('test/Fresh') {}
export const fresh = kind(Fresh, (_: null, home: string) => Effect.sync(() => { mkdirSync(home, { recursive: true }); mkdirSync(join(home, 'seed')); return { home }; }));
`,
  );
  const body = `import { test } from 'bun:test';
import { open } from ${JSON.stringify(WORLDS)};
import { fresh } from './fresh.ts';
test('takes the world', async () => { await open(fresh, null); });
`;
  for (const name of ['a.itest.ts', 'b.itest.ts']) writeFileSync(join(root, name), body);
  const child = Bun.spawn(['bun', 'test', '--parallel=1', './a.itest.ts', './b.itest.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, stdout + stderr).toBe(0);
});

test("a shared world's background process under a following unit file is the world's, a file's own late spawn stays its leftover, and the unit file's own call is refused", async () => {
  const root = join(process.env['TMPDIR']!, `mixed-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(
    join(root, 'kinds.ts'),
    `import { Context, Effect } from ${JSON.stringify(EFFECT)};
import { kind } from ${JSON.stringify(WORLDS)};
export class Background extends Context.Service<Background, {}>()('test/Background') {}
const spawned = () =>
  Effect.sync(() => {
    try {
      Bun.spawn(['sleep', '321'], { stdout: 'ignore', stderr: 'ignore' }).unref();
      return 'spawned';
    } catch (error) {
      return String(error);
    }
  });
export const background = kind(Background, (_: null) =>
  Effect.as(
    Effect.forkScoped(
      Effect.gen(function* () {
        while ((globalThis as { go?: true }).go === undefined) yield* Effect.sleep('5 millis');
        (globalThis as { spawned?: string }).spawned = yield* spawned();
      }),
    ),
    {},
  ),
);
`,
  );
  writeFileSync(
    join(root, 'a.itest.ts'),
    `import { test } from 'bun:test';
import { open } from ${JSON.stringify(WORLDS)};
import { background } from './kinds.ts';
test('takes the world', async () => { await open(background, null); });
test('leaves work of its own behind', () => {
  void (async () => {
    while ((globalThis as { go?: true }).go === undefined) await Bun.sleep(5);
    Bun.spawn(['sleep', '322'], { stdout: 'ignore', stderr: 'ignore' }).unref();
    (globalThis as { late?: true }).late = true;
  })();
});
`,
  );
  writeFileSync(
    join(root, 'b.test.ts'),
    `import { expect, test } from 'bun:test';
test("the world's background spawn is not this file's call", async () => {
  (globalThis as { go?: true }).go = true;
  while ((globalThis as { spawned?: string }).spawned === undefined || (globalThis as { late?: true }).late === undefined) await Bun.sleep(5);
  expect((globalThis as { spawned?: string }).spawned).toBe('spawned');
});
test('its own spawn is refused', () => {
  expect(() => Bun.spawnSync(['true'])).toThrow('b.test.ts × process');
});
`,
  );
  const report = join(root, 'report.jsonl');
  const child = Bun.spawn(['bun', CLI, 'bun', 'test', '--no-isolate', '--parallel=1', './a.itest.ts', './b.test.ts'], {
    cwd: root,
    env: { ...process.env, RUNLITH_TEST_REPORT: report },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  expect(code, output).toBe(1);
  expect(output).toMatch(/1 process\(es\) outlived[^\n]*\n[^\n]*sleep 322[^\n]* from [^\n]*a\.itest\.ts/);
  const rows = readFileSync(report, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FileRow | RefusalRow);
  expect(rows.flatMap((row) => (row.type === 'refusal' ? [[row.file.split('/').at(-1), row.via]] : []))).toEqual([
    ['b.test.ts', 'spawnSync'],
  ]);
  expect(rows.flatMap((row) => (row.type === 'file' ? [[row.file.split('/').at(-1), row.residue]] : []))).toEqual([
    ['a.itest.ts', 0],
    ['b.test.ts', 1],
  ]);
});

test('a run world is built once for every worker of the run, and each reads the value its builder published', async () => {
  const root = join(process.env['TMPDIR']!, `run-worlds-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(
    join(root, 'kinds.ts'),
    `import { Effect } from ${JSON.stringify(EFFECT)};
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runKind } from ${JSON.stringify(WORLDS)};
export const stamp = runKind('test/Stamp', (_: null, directory: string) =>
  Effect.andThen(Effect.sleep('300 millis'), Effect.sync(() => {
    appendFileSync(process.env.WORLD_BUILDS!, 'built\\n');
    writeFileSync(join(directory, 'stamp'), String(process.pid));
    return process.pid;
  })),
);
`,
  );
  const body = (file: string) => `import { test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from ${JSON.stringify(EFFECT)};
import { once } from ${JSON.stringify(WORLDS)};
import { stamp } from './kinds.ts';
test('takes the run world', async () => {
  const made = await Effect.runPromise(once(stamp, null));
  ${said(file, "made.value === Number(readFileSync(join(made.directory, 'stamp'), 'utf8')) ? made.value : -1")};
});
`;
  for (const file of ['a', 'b']) writeFileSync(join(root, `${file}.itest.ts`), body(file));
  const builds = join(root, 'builds');
  writeFileSync(builds, '');
  const child = Bun.spawn(['bun', 'test', '--parallel=2', '--no-isolate', './a.itest.ts', './b.itest.ts'], {
    cwd: root,
    env: { ...process.env, WORLD_BUILDS: builds, RUNLITH_TEST_REPORT: join(root, 'report.jsonl') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  const rows = output.split('\n').flatMap((line) => (line.startsWith('{"file"') ? [JSON.parse(line) as Said] : []));
  expect(code, output).toBe(0);
  expect(readFileSync(builds, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.world)).size).toBe(1);
  expect(rows[0]!.world).toBeGreaterThan(0);
});

test('each worker builds a shared world once for every file that takes it, an own world stands apart, a failed build answers its waiters, and every world ends with the run', async () => {
  const root = join(process.env['TMPDIR']!, `worlds-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(join(root, 'kinds.ts'), KINDS);
  for (const [name, body] of Object.entries(FILES)) writeFileSync(join(root, name), body);
  const builds = join(root, 'builds');
  writeFileSync(builds, '');
  const child = Bun.spawn(['bun', 'test', '--parallel=2', '--no-isolate', ...Object.keys(FILES).map((name) => `./${name}`)], {
    cwd: root,
    env: { ...process.env, WORLD_BUILDS: builds, RUNLITH_TEST_REPORT: join(root, 'report.jsonl') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  const rows = output.split('\n').flatMap((line) => (line.startsWith('{"file"') ? [JSON.parse(line) as Said] : []));
  const of = (file: string): Said => rows.find((row) => row.file === file)!;
  const shared = [of('open'), of('layer')];
  const workers = new Set(shared.map((row) => row.worker));
  expect(code, output).toBe(0);
  expect(readFileSync(builds, 'utf8').split('\n').filter(Boolean).length).toBe(workers.size + 1);
  if (workers.size === 1) expect(shared[0]!.world).toBe(shared[1]!.world);
  expect(shared.map((row) => row.world)).not.toContain(of('own').world);
  expect(of('broken').world).toBe(2);
  const ended = async (pid: number): Promise<number> => {
    while (alive(pid)) await Bun.sleep(20);
    return pid;
  };
  const worlds = [...shared, of('own'), of('early'), of('late')].map((row) => row.world);
  expect(await Promise.all(worlds.map(ended))).toEqual(worlds);
});
