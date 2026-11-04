#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { constants, getPriority, setPriority } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { kindOf, runsAs, runsOnPlatform, type Kind } from './core/files.ts';
import type { FileRow, NotRunRow, Row, TestRow, WorldRow } from './core/ledger.ts';
import { openProcesses } from './core/processes.ts';
import { openRun, REPORT_ENV, ROOT_ENV, sweepRuns } from './core/run.ts';
import { acquireUnits, ADMITTED_ENV, budgetRoot, machineBudget, NICE, SLOT_ENV } from './slots.ts';
import { junitOf, outcomesOf, runOf, slowOf, summary, verdictsOf, workersOf, worldsOf } from './report.ts';
import { HEADED_ENV } from './fixture.ts';
import { shardTimings, TIMINGS } from './timings.ts';

const REPO = resolve(import.meta.dir, '../../..');
const TAIL_MS = 250;

const KINDS: Readonly<Record<string, { readonly kind: Kind; readonly suffix: string; readonly pathspec: string }>> = {
  e2e: { kind: 'e2e', suffix: '.e2e.ts', pathspec: '*.e2e.ts' },
  itest: { kind: 'resource', suffix: '.itest.ts', pathspec: '*.itest.*' },
};
const discover = async (kind: Kind, pathspec: string): Promise<string[]> => {
  const cwd = process.cwd();
  const tracked = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', pathspec], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let found: string[];
  if (tracked.exitCode === 0) found = tracked.stdout.toString().split('\0').filter(Boolean);
  else if (tracked.stderr.toString().includes('not a git repository'))
    found = await Array.fromAsync(new Bun.Glob(`**/${pathspec}`).scan({ cwd, onlyFiles: true, followSymlinks: false }));
  else throw new Error(`test discovery failed: ${tracked.stderr.toString()}`);
  const packages = new Map<string, boolean>();
  const nested = (directory: string): boolean => {
    let known = packages.get(directory);
    if (known === undefined) packages.set(directory, (known = existsSync(join(cwd, directory, 'package.json'))));
    return known;
  };
  return found
    .filter((file) => runsAs(kind, file, nested))
    .map((file) => resolve(file))
    .filter((file) => existsSync(file));
};

const command = process.argv.slice(2);
const flagValues = new Set([
  '-t',
  '--test-name-pattern',
  '--timeout',
  '--rerun-each',
  '--retry',
  '--seed',
  '--coverage-reporter',
  '--coverage-dir',
  '--reporter',
  '--reporter-outfile',
  '--max-concurrency',
  '--path-ignore-patterns',
  '--parallel-delay',
  '--shard',
  '--timings',
  '--preload',
  '--require',
  '-r',
  '--env-file',
  '--define',
  '--loader',
  '--conditions',
]);
const selected = KINDS[command[0] ?? ''];
const program = command[0] === 'e2e' && command[1] === '--program';
let headed = false;
if (program) {
  const file = command[2];
  if (file === undefined) throw new Error('e2e --program needs a program file');
  if (!existsSync(resolve(file))) throw new Error(`e2e program does not exist: ${file}`);
  command.splice(0, 3, 'bun', resolve(file));
} else if (selected !== undefined) {
  const word = command[0]!;
  const flags: string[] = [];
  const files: string[] = [];
  let positional = false;
  for (let at = 1; at < command.length; at++) {
    const part = command[at]!;
    if (!positional && selected.kind === 'e2e' && part === '--headed') {
      headed = true;
      continue;
    }
    if (part === '--') {
      positional = true;
      continue;
    }
    if (!positional && part.startsWith('-')) {
      flags.push(part);
      if (flagValues.has(part)) {
        const value = command[++at];
        if (value === undefined) throw new Error(`${part} needs a value`);
        flags.push(value);
      } else if ((part === '--bail' || part === '--parallel') && /^\d+$/.test(command[at + 1] ?? '')) flags.push(command[++at]!);
      else if (
        part === '--changed' &&
        command[at + 1] !== undefined &&
        !command[at + 1]!.startsWith('-') &&
        kindOf(command[at + 1]!) !== selected.kind
      )
        flags.push(command[++at]!);
      continue;
    }
    if (kindOf(part) !== selected.kind) throw new Error(`${word} expects ${selected.suffix} files, received ${part}`);
    const file = resolve(part);
    if (!existsSync(file)) throw new Error(`${word} file does not exist: ${part}`);
    files.push(file);
  }
  if (files.length === 0) files.push(...(await discover(selected.kind, selected.pathspec)));
  if (files.length === 0) {
    console.error(`testbed: no ${selected.suffix} files found`);
    process.exit(1);
  }
  const eligible = files.filter((file) => runsOnPlatform(file));
  if (eligible.length === 0) {
    console.error(`testbed: ${files.length} platform-specific files do not run on ${process.platform}`);
    process.exit(0);
  }
  command.splice(0, command.length, 'bun', 'test', ...flags, ...new Set(eligible.sort()));
}
if (command.length === 0) {
  console.error('usage: testbed <command> [args...]   runs a test runner on its share of the machine and writes the run report');
  process.exit(2);
}
const vitest = !program && command.some((part) => ['vitest', 'vitest.mjs'].includes(basename(part)));
const bunTest = !program && basename(command[0]!) === 'bun' && command.find((part, index) => index > 0 && !part.startsWith('-')) === 'test';
if (bunTest && selected === undefined) {
  const named = command.filter((part) => /\.(?:test|itest|e2e|spec)\.[cm]?[jt]sx?$/.test(part));
  const filters: string[] = [];
  for (let at = command.indexOf('test') + 1; at < command.length; at++) {
    const part = command[at]!;
    if (flagValues.has(part) || ((part === '--bail' || part === '--parallel') && /^\d+$/.test(command[at + 1] ?? ''))) at++;
    else if (!part.startsWith('-')) filters.push(part.replace(/^\.\//, ''));
  }
  const files =
    named.length === 0
      ? (await Promise.all([discover('unit', '*.test.*'), discover('unit', '*.spec.*')]))
          .flat()
          .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
      : named;
  const eligible = files.filter((file) => runsOnPlatform(file));
  if (files.length > 0 && eligible.length === 0) {
    console.error(`testbed: ${files.length} platform-specific files do not run on ${process.platform}`);
    process.exit(0);
  }
  if (named.length === 0) command.push(...eligible);
  else
    for (let at = command.length - 1; at >= 0; at--) {
      if (named.includes(command[at]!) && !runsOnPlatform(command[at]!)) command.splice(at, 1);
    }
}
const runner = bunTest ? 'bun' : vitest ? 'vitest' : 'other';
const budget = machineBudget(process.env);
const options = (): number => (command.includes('--') ? command.indexOf('--') : command.length);

const take = (flag: RegExp): number | undefined => {
  let found: number | undefined;
  for (let at = 0; at < options();) {
    const part = command[at]!;
    if (!flag.test(part.split('=')[0]!)) {
      at++;
      continue;
    }
    const joined = part.includes('=');
    const value = joined ? part.slice(part.indexOf('=') + 1) : /^\d+$/.test(command[at + 1] ?? '') ? command[at + 1] : undefined;
    command.splice(at, joined || value === undefined ? 1 : 2);
    if (value === undefined) continue;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${part} must name a positive integer`);
    found = parsed;
  }
  return found;
};
const named = command.filter((part) => !part.startsWith('-') && /\.[cm]?[jt]sx?$/.test(part));
const quantum = program || (bunTest && named.some((file) => kindOf(file) === 'e2e')) ? Math.min(2, budget) : 1;
const asked = bunTest ? take(/^--parallel$/) : vitest ? take(/^--max(?:Workers|-workers)$/) : undefined;
const concurrency = bunTest ? take(/^--max-concurrency$/) : undefined;
const jobs = process.env['TESTBED_JOBS'] === undefined ? undefined : Number(process.env['TESTBED_JOBS']);
if (jobs !== undefined && (!Number.isSafeInteger(jobs) || jobs < 1)) throw new Error('TESTBED_JOBS must be a positive integer');
const wanted = program
  ? 1
  : Math.min(
      asked ?? budget,
      jobs ?? budget,
      bunTest && named.length > 0 ? named.length : budget,
      Math.max(1, Math.floor(budget / quantum)),
    );

const processes = await openProcesses();
const [holderPid, holderStart, holderUnits] = (process.env[SLOT_ENV] ?? '').split(':').map(Number);
const inherited = holderPid !== undefined && holderPid > 0 && processes.facts(holderPid)?.start === holderStart;
const queueBefore = process.cpuUsage();
const units =
  inherited || (runner === 'other' && !program)
    ? undefined
    : await acquireUnits(
        budgetRoot(),
        budget,
        wanted * quantum,
        process.env[ADMITTED_ENV] === '1',
        (commands) =>
          console.error(`testbed: fewer than ${quantum} of ${budget} processes are free beside ${commands} other commands; waiting`),
        quantum,
      );
const queueCpu = process.cpuUsage(queueBefore);
process.once('exit', () => units?.release());
const granted = holderUnits !== undefined && Number.isSafeInteger(holderUnits) && holderUnits > 0 ? holderUnits : 1;
const held = units?.held ?? Math.max(1, Math.min(wanted * quantum, granted));
const workers = Math.max(1, Math.floor(held / quantum));
if (bunTest) command.splice(options(), 0, `--parallel=${workers}`, `--max-concurrency=${Math.min(workers, concurrency ?? workers)}`);
if (vitest) command.splice(options(), 0, `--maxWorkers=${workers}`);
console.error(
  runner === 'other' && !program && !inherited
    ? `testbed: a ${budget}-process budget; the test runners this command starts take their own shares`
    : `testbed: ${held} of ${inherited ? `${granted} inherited` : budget} processes; queued ${((units?.queued ?? 0) / 1000).toFixed(3)} s`,
);
const holder = inherited
  ? program
    ? `${holderPid}:${holderStart}:${held}`
    : process.env[SLOT_ENV]
  : units === undefined
    ? undefined
    : `${process.pid}:${processes.facts(process.pid)?.start ?? 0}:${held}`;
if (getPriority(process.pid) < NICE) setPriority(process.pid, NICE);
const run = openRun({ pid: process.pid, start: processes.facts(process.pid)?.start ?? 0 });
if (run.fresh) sweepRuns(processes);

if (bunTest) command.splice(command.indexOf('test') + 1, 0, `--preload=${join(REPO, 'packages/testbed/src/bun.ts')}`);
const option = (prefix: string): string | undefined => command.find((part) => part.startsWith(prefix))?.slice(prefix.length);
const randomize = command.indexOf('--randomize');
let seed: number | undefined;
if (runner === 'bun') {
  for (let at = 0; at < options(); at++) {
    const part = command[at]!;
    if (part === '--seed') seed = Number(command[++at]);
    else if (part.startsWith('--seed=')) seed = Number(part.slice('--seed='.length));
  }
  if (seed === undefined && randomize !== -1) {
    seed = Math.floor(Math.random() * 2 ** 31);
    command.push(`--seed=${seed}`);
  }
} else if (runner === 'vitest' && randomize !== -1) {
  const given = option('--sequence.seed=');
  seed = given === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(given);
  command.splice(randomize, 1, '--sequence.shuffle', ...(given === undefined ? [`--sequence.seed=${seed}`] : []));
}
const inheritedSeed = Number(process.env['RUNLITH_TEST_SEED']);
const variantSeed = seed ?? (Number.isSafeInteger(inheritedSeed) ? inheritedSeed : Math.floor(Math.random() * 2 ** 31));
const junit = join(run.root, 'junit.xml');
if (bunTest && option('--reporter') === undefined) command.push('--reporter=junit', `--reporter-outfile=${junit}`);
if (bunTest && option('--timings') === undefined) {
  const at = command.findIndex((part, index) => index < options() && (part === '--shard' || part.startsWith('--shard=')));
  const shard = at === -1 ? undefined : command[at]!.startsWith('--shard=') ? command[at]!.slice('--shard='.length) : command[at + 1];
  if (at !== -1 && shard === undefined) throw new Error('--shard needs a value');
  command.push(...(shard === undefined ? [] : [`--timings=${shardTimings(shard)}`]), `--timings=${TIMINGS}`, '--update-timings');
}

const started = Number(process.hrtime.bigint()) / 1e6;
const before = processes.reaped() ?? 0;
const environment: Record<string, string | undefined> = {
  ...process.env,
  [ROOT_ENV]: run.root,
  [REPORT_ENV]: run.report,
  [SLOT_ENV]: holder,
  [HEADED_ENV]: headed ? '1' : undefined,
  RUNLITH_TEST_SEED: String(variantSeed),
};
delete environment[ADMITTED_ENV];
const child = Bun.spawn(command, {
  stdio: ['inherit', 'inherit', 'inherit', ...(units === undefined ? [] : [units.entry])],
  env: environment,
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
let kept = held;
const seen = new Set<number>();
const tail =
  bunTest && units !== undefined && workers > 1
    ? setInterval(() => {
        const living = processes.children(child.pid).filter((pid) => / --test-worker(?: |$)/.test(processes.command(pid) ?? ''));
        for (const pid of living) seen.add(pid);
        const needed = Math.max(1, living.length) * quantum;
        if (seen.size < workers || needed >= kept) return;
        kept = units.keep(needed);
        console.error(`testbed: ${living.length} workers left; ${kept} of ${held} processes kept`);
      }, TAIL_MS)
    : undefined;
const exit = await child.exited;
clearInterval(tail);
const signal = child.signalCode;
const code = signal === null ? exit : 128 + (typeof signal === 'number' ? signal : constants.signals[signal]);
units?.release();
const wall = Number(process.hrtime.bigint()) / 1e6 - started;
const own = process.cpuUsage();
const cpu = (processes.reaped() ?? 0) - before + (own.user + own.system - queueCpu.user - queueCpu.system) / 1000;

const rows: Row[] = existsSync(run.report)
  ? readFileSync(run.report, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Row)
  : [];
const mine = (row: Row): boolean => (row as { run?: unknown }).run === run.root;
const files = rows.filter((row): row is FileRow => row.type === 'file' && mine(row));
const tests = rows.filter((row): row is TestRow => row.type === 'test' && mine(row));
const notRun = rows.filter((row): row is NotRunRow => row.type === 'not-run' && mine(row));
const worlds = worldsOf(rows.filter((row): row is WorldRow => row.type === 'world' && mine(row)));
const reported = runner === 'bun' && existsSync(junit) ? junitOf(readFileSync(junit, 'utf8'), process.cwd(), REPO) : undefined;
const outcomes = reported === undefined ? { rows: [], unmatched: 0 } : outcomesOf(tests, reported.cases);
const verdicts = reported === undefined ? [] : verdictsOf(files, reported);
const slow = slowOf(tests, outcomes.rows, files);
const runRow = runOf(
  { root: run.root, runner, command, cwd: process.cwd(), repo: REPO, seed, wall, cpu, queued: units?.queued ?? 0, code: code ?? 1 },
  files,
  tests.length,
  worlds,
);
appendFileSync(
  run.report,
  `${[...outcomes.rows, ...verdicts, ...slow, ...workersOf(files).map((worker) => ({ ...worker, run: run.root })), runRow].map((row) => JSON.stringify(row)).join('\n')}\n`,
);
console.error(summary(runRow, files, slow, outcomes.unmatched, run.report, notRun));
console.error(seed === undefined ? `  variant seed: ${variantSeed} (RUNLITH_TEST_SEED replays it)` : `  seed: ${seed}`);
process.exit(code ?? 1);
