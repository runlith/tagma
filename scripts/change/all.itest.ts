import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { packagesOf } from './packages.ts';
import { suitesOf } from './suites.ts';
import { vitestConfigsOf } from './vitestConfigs.ts';
import { budgetOf, memoryOf } from '@runlith/testbed/budget';
import { rendezvousSource } from './testing/rendezvous.ts';

test('combined Vitest follows new workspace packages and extra configs while preserving the app cwd', () => {
  const files = new Map([
    ['package.json', JSON.stringify({ workspaces: ['packages/*', 'apps/*'] })],
    ['packages/one/package.json', JSON.stringify({ scripts: { test: 'vitest run && vitest run --config bench.ts' } })],
    ['packages/one/vite.config.ts', ''],
    ['packages/one/bench.ts', ''],
    ['packages/two/package.json', JSON.stringify({ scripts: { test: 'vitest run' } })],
    ['packages/two/vitest.config.ts', ''],
    ['apps/client/package.json', JSON.stringify({ scripts: { test: 'vitest run' } })],
  ]);
  const paths = [...files.keys()];
  const packages = packagesOf(paths, (path) => files.get(path)!);
  expect(vitestConfigsOf(packages, paths).map((config) => config.file)).toEqual([
    'packages/one/vite.config.ts',
    'packages/one/bench.ts',
    'packages/two/vitest.config.ts',
  ]);
  const plan = suitesOf(packages, paths, {
    root: '/',
    jobs: 1,
    seed: undefined,
    randomize: false,
    reports: '/reports',
    combineVitest: true,
  });
  expect(plan.map((suite) => [suite.id, suite.directory])).toEqual([
    ['packages:vitest:test', ''],
    ['apps/client:test', 'apps/client'],
  ]);
});

test('a package script is one suite whose runner gets every file it selects, however many there are', () => {
  const script = "testbed bun test --no-isolate $(find src -name '*.itest.ts' | sed 's|^|./|')";
  const files = new Map([
    ['package.json', JSON.stringify({ workspaces: ['packages/*'] })],
    ['packages/w/package.json', JSON.stringify({ scripts: { 'test:integration': script } })],
    ...Array.from({ length: 60 }, (_, at) => [`packages/w/src/f${at}.itest.ts`, ''] as const),
  ]);
  const plan = suitesOf(
    packagesOf([...files.keys()], (path) => files.get(path)!),
    [...files.keys()],
    { root: '/', jobs: undefined, seed: undefined, randomize: false, reports: '/reports', combineVitest: false },
  );
  expect(plan.map((suite) => suite.id)).toEqual(['packages/w:test:integration']);
  expect(plan[0]!.stages).toEqual([expect.stringContaining("$(find src -name '*.itest.ts'")]);
});

test('a cut native suite stays pending and its CPU survives a successful resume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cut-suites-'));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: `bun -e 'if (!process.env.RUNLITH_TEST_NATIVE_DONE) process.kill(process.pid, "SIGTERM")'`,
        },
      }),
    );
    const report = join(root, 'reading.json');
    const invoke = async (complete: boolean) => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, 'all.ts'),
          '--root',
          root,
          '--jobs',
          '1',
          '--report',
          report,
          ...(complete ? ['--resume'] : []),
        ],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, RUNLITH_TEST_NATIVE_DONE: complete ? '1' : '' },
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, output: stdout + stderr };
    };
    const first = await invoke(false);
    expect(first.code, first.output).toBe(2);
    const before = JSON.parse(readFileSync(report, 'utf8'));
    expect(before.pending).toEqual(['.:test']);
    expect(before.suites).toHaveLength(0);
    expect(before.aborted).toHaveLength(1);
    const second = await invoke(true);
    expect(second.code, second.output).toBe(0);
    const after = JSON.parse(readFileSync(report, 'utf8'));
    expect(after.complete).toBe(true);
    expect(after.aborted).toHaveLength(1);
    expect(after.cpu).toBeGreaterThanOrEqual(after.aborted[0].cpu + after.suites[0].cpu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('all suites resume without replay and report an unconfigured workspace failure by file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'all-suites-'));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    mkdirSync(join(root, 'pkg'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['pkg'] }));
    writeFileSync(
      join(root, 'pkg/package.json'),
      JSON.stringify({ scripts: { test: 'bun test ./pass.test.ts', 'test:integration': "bun test $(find . -name '*.itest.ts')" } }),
    );
    const report = join(root, 'reading.json');
    writeFileSync(join(root, 'pkg/pass.test.ts'), "import { expect, test } from 'bun:test'; test('sum', () => expect(2 + 2).toBe(4));");
    writeFileSync(
      join(root, 'pkg/red.itest.ts'),
      "import { expect, test } from 'bun:test'; test('wrong sum', () => expect(2 + 2).toBe(5));",
    );
    const invoke = async (...args: string[]) => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, 'all.ts'),
          '--root',
          root,
          ...(args.includes('--jobs') ? [] : ['--jobs', '1']),
          '--report',
          report,
          ...args,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, output: stdout + stderr };
    };
    const first = await invoke('--max-suites', '1');
    expect(first.code, first.output).toBe(2);
    const before = JSON.parse(readFileSync(report, 'utf8'));
    expect(before.suites.map((row: { id: string }) => row.id)).toEqual(['pkg:test']);
    expect(before.pending).toEqual(['pkg:test:integration']);
    expect(before.aborted).toEqual([]);
    expect(before.suites[0].files).toBe(1);
    expect(before.suites[0].cpu).toBeGreaterThan(0);
    const second = await invoke('--resume');
    expect(second.code, second.output).toBe(1);
    const after = JSON.parse(readFileSync(report, 'utf8'));
    expect(after.complete).toBe(true);
    expect(after.suites[0]).toEqual(before.suites[0]);
    expect(after.suites[1].failed).toEqual([expect.stringContaining('/pkg/red.itest.ts')]);
    const refused = await invoke('--plan', '--jobs', '0');
    expect(refused.code, refused.output).not.toBe(0);
    expect(refused.output).toContain('--jobs must be a positive integer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stopping test:all preserves completed file output and ends the current stage of a compound suite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stop-suites-'));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    const mark = join(root, 'stage.pid');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: `bun test --parallel=1 --no-isolate ./finished.itest.ts && bun -e "const fs = require('fs'); fs.watch(process.env.STAGE_ROOT, () => {}); fs.writeFileSync(process.env.STAGE_MARK, String(process.pid))"`,
        },
      }),
    );
    writeFileSync(
      join(root, 'finished.itest.ts'),
      "import { expect, test } from 'bun:test'; test('completed file', () => { console.log('finished stdout'); console.error('finished stderr'); expect(2 + 2).toBe(4); });",
    );
    const env: Record<string, string | undefined> = {
      ...process.env,
      STAGE_MARK: mark,
      STAGE_ROOT: root,
      TESTBED_BUDGET_ROOT: join(root, 'budget'),
    };
    const reached = Promise.withResolvers<void>();
    const watcher = watch(root, () => {
      if (existsSync(mark) && readFileSync(mark, 'utf8') !== '') reached.resolve();
    });
    const report = join(root, 'reading.json');
    const child = Bun.spawn([process.execPath, 'run', 'test:all', '--root', root, '--jobs', '1', '--report', report], {
      cwd: join(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    void child.exited.then(() => reached.resolve());
    try {
      await reached.promise;
      expect(existsSync(mark), existsSync(mark) ? '' : (await output).join('\n')).toBe(true);
      const stage = Number(readFileSync(mark, 'utf8'));
      const log = join(`${report}.d`, '.%3Atest.log');
      const written = Promise.withResolvers<string>();
      const readSaved = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
      const checkSaved = () => {
        const saved = readSaved();
        if (['finished stdout', 'finished stderr', '(pass) completed file'].every((part) => saved.includes(part))) written.resolve(saved);
      };
      const logWatcher = watch(dirname(log), checkSaved);
      try {
        checkSaved();
        const saved = await Promise.race([written.promise, child.exited.then(readSaved)]);
        expect(child.exitCode).toBeNull();
        child.kill('SIGTERM');
        await output;
        expect(() => process.kill(stage, 0)).toThrow();
        expect(saved).toContain('finished stdout');
        expect(saved).toContain('finished stderr');
        expect(saved).toContain('(pass) completed file');
        expect(readFileSync(log, 'utf8')).toStartWith(saved);
      } finally {
        logWatcher.close();
      }
    } finally {
      watcher.close();
      child.kill('SIGTERM');
      await output;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('suites run side by side while the machine budget has room, and one at a time under --jobs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'side-suites-'));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['one', 'two'] }));
    for (const [name, other] of [
      ['one', 'two'],
      ['two', 'one'],
    ] as const) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'package.json'), JSON.stringify({ scripts: { test: 'bun test ./meet.itest.ts' } }));
      writeFileSync(join(root, name, 'meet.itest.ts'), rendezvousSource(root, name, other));
    }
    const env: Record<string, string | undefined> = {
      ...process.env,
      TESTBED_CORES: '12',
      TESTBED_BUDGET_ROOT: join(root, 'budget'),
    };
    delete env['RUNLITH_TEST_SLOT'];
    const invoke = async (report: string, meet: boolean, ...args: string[]) => {
      for (const name of ['one', 'two'])
        for (const mark of ['started', 'ready', 'ended']) rmSync(join(root, `${name}.${mark}`), { force: true });
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'all.ts'), '--root', root, '--report', join(root, report), ...args],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...env, MEET: meet ? '1' : '0' },
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, output: stdout + stderr };
    };
    const side = await invoke('side.json', budgetOf(12, memoryOf()) > 1);
    expect(side.code, side.output).toBe(0);
    const alone = await invoke('alone.json', false, '--jobs', '1');
    expect(alone.code, alone.output).toBe(0);
    const stages = [...alone.output.matchAll(/^test:all: (one|two):test(?: (pass|FAIL|CUT):[^\n]*)?$/gm)];
    expect(stages.map((stage) => stage[2] ?? 'started')).toEqual(['started', 'pass', 'started', 'pass']);
    expect(stages[0]?.[1]).toBe(stages[1]?.[1]);
    expect(stages[2]?.[1]).toBe(stages[3]?.[1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
