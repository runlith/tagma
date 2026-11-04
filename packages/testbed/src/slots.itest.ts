import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { machineBudget, SLOT_ENV } from './slots.ts';

const CLI = join(import.meta.dir, 'cli.ts');
const CORES = 12;
const FILES = 12;

type Run = {
  readonly child: ReturnType<typeof Bun.spawn>;
  readonly line: (pattern: RegExp) => Promise<string>;
  readonly running: () => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly release: () => void;
};

const pool = () => {
  const root = join(process.env['TMPDIR']!, `budget-${crypto.randomUUID()}`);
  const units = join(root, 'units');
  mkdirSync(units, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    TESTBED_CORES: String(CORES),
    TESTBED_BUDGET: undefined,
    TESTBED_BUDGET_ROOT: units,
  };
  delete env[SLOT_ENV];
  const start = (name: string, holding: (index: number) => boolean = () => true): Run => {
    const dir = join(root, name);
    mkdirSync(dir);
    const release = join(dir, 'release');
    const niceness = join(dir, 'nice');
    for (let index = 0; index < FILES; index++)
      writeFileSync(
        join(dir, `w${index}.itest.ts`),
        `import { test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { getPriority } from 'node:os';
test('holds', async () => {
  writeFileSync(${JSON.stringify(join(dir, `up-${index}`))}, '');
  ${index === 0 ? `writeFileSync(${JSON.stringify(niceness)}, \`\${getPriority()} \${Bun.spawnSync(['/bin/sh', '-c', 'ps -o nice= -p $$']).stdout.toString().trim()}\`);` : ''}
  if (!${holding(index)}) await Bun.sleep(600);
  while (${holding(index)} && !existsSync(${JSON.stringify(release)})) await Bun.sleep(5);
});
`,
      );
    const child = Bun.spawn(
      [process.execPath, CLI, 'bun', 'test', ...Array.from({ length: FILES }, (_, index) => `./w${index}.itest.ts`)],
      { cwd: dir, env: { ...env, RUNLITH_TEST_REPORT: join(dir, 'report.jsonl') }, stdout: 'ignore', stderr: 'pipe', detached: true },
    );
    let seen = '';
    const reader = (child.stderr as ReadableStream<Uint8Array>).getReader();
    const line = async (pattern: RegExp): Promise<string> => {
      for (;;) {
        const found = pattern.exec(seen);
        if (found !== null) return found[1] ?? found[0];
        const read = await reader.read();
        if (read.done) throw new Error(`${name} ended before ${pattern}: ${seen}`);
        seen += new TextDecoder().decode(read.value);
      }
    };
    const running = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const up = (): boolean => readdirSync(dir).some((entry) => entry.startsWith('up-'));
        const watcher = watch(dir, () => {
          if (!up()) return;
          watcher.close();
          resolve();
        });
        child.exited.then(() => {
          watcher.close();
          reject(new Error(`${name} ended before any of its tests ran: ${seen}`));
        });
        if (!up()) return;
        watcher.close();
        resolve();
      });
    const kill = async (): Promise<void> => {
      process.kill(-child.pid, 'SIGKILL');
      while (!(await reader.read()).done);
      await child.exited;
    };
    return { child, line, running, kill, release: () => writeFileSync(release, '') };
  };
  return { root, units, start };
};

const held = (run: Run) => run.line(/testbed: (\d+) of \d+ processes/).then(Number);

const finish = async (runs: readonly Run[]): Promise<void> => {
  for (const run of runs) run.release();
  for (const run of runs) if (run.child.exitCode === null && run.child.signalCode === null) await run.child.exited;
};

test('worker families fit CPU and memory capacity without starving a small machine', () => {
  const gib = 1024 ** 3;
  expect(machineBudget({ TESTBED_CORES: '12' }, 32 * gib)).toBe(8);
  expect(machineBudget({ TESTBED_CORES: '64' }, 8 * gib)).toBe(2);
  expect(machineBudget({ TESTBED_CORES: '64' }, 256 * gib)).toBe(42);
  expect(machineBudget({ TESTBED_CORES: '1' }, gib / 2)).toBe(1);
});

test('a fixed budget replaces the shared-machine formula', () => {
  expect(machineBudget({ TESTBED_CORES: '3', TESTBED_BUDGET: '3' }, 7 * 1024 ** 3)).toBe(3);
  expect(() => machineBudget({ TESTBED_BUDGET: '0' })).toThrow('TESTBED_BUDGET must be a positive integer');
});

test('runs share the machine budget at entry, never exceed it, and get back the processes of a killed run', async () => {
  const { root, units, start } = pool();
  const budget = machineBudget({ TESTBED_CORES: String(CORES) });
  const runs: Run[] = [];
  try {
    const alone = start('alone');
    runs.push(alone);
    expect(await held(alone)).toBe(budget);

    const first = start('first');
    const second = start('second');
    runs.push(first, second);
    await Promise.all([first.line(/; waiting/), second.line(/; waiting/)]);
    alone.release();
    expect(await alone.child.exited).toBe(0);
    const firstHeld = held(first);
    const secondHeld = held(second);
    if (budget === 1) {
      const admitted = await Promise.race([firstHeld.then(() => first), secondHeld.then(() => second)]);
      expect(await (admitted === first ? firstHeld : secondHeld)).toBe(1);
      await admitted.running();
      await admitted.kill();
      expect(await (admitted === first ? secondHeld : firstHeld)).toBe(1);
    } else {
      const shares = await Promise.all([firstHeld, secondHeld]);
      expect([...shares].sort((a, b) => a - b)).toEqual([Math.floor(budget / 2), Math.ceil(budget / 2)]);
      expect(shares[0]! + shares[1]!).toBeLessThanOrEqual(budget);

      await first.running();
      await first.kill();
      const next = start('next');
      runs.push(next);
      expect(await held(next)).toBe(budget - shares[1]!);
    }

    const [priority, inherited] = readFileSync(join(root, 'alone', 'nice'), 'utf8')
      .split(' ')
      .map(Number);
    expect(priority).toBeGreaterThanOrEqual(10);
    expect(inherited).toBeGreaterThanOrEqual(10);
  } finally {
    await finish(runs);
    expect(existsSync(units)).toBe(true);
  }
});

test('a run gives back spare workers, and a single-worker run keeps its only place until it ends', async () => {
  const { start } = pool();
  const budget = machineBudget({ TESTBED_CORES: String(CORES) });
  const runs: Run[] = [];
  try {
    const tail = start('tail', (index) => index === 0);
    runs.push(tail);
    expect(await held(tail)).toBe(budget);
    if (budget > 1) expect(await tail.line(/; 1 of \d+ processes kept/)).toBeTruthy();

    const next = start('next');
    runs.push(next);
    if (budget === 1) {
      await next.line(/; waiting/);
      tail.release();
      expect(await tail.child.exited).toBe(0);
    }
    expect(await held(next)).toBe(Math.ceil(budget / 2));
  } finally {
    await finish(runs);
  }
});
