#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { constants, getPriority, setPriority } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { FileRow, Row, TestRow, WorldRow } from './core/ledger.ts';
import { openProcesses } from './core/processes.ts';
import { openRun, REPORT_ENV, ROOT_ENV, sweepRuns } from './core/run.ts';
import { acquireUnits, ADMITTED_ENV, budgetOf, budgetRoot, coresOf, NICE, SLOT_ENV } from './slots.ts';
import { junitOf, outcomesOf, runOf, summary, verdictsOf, workersOf, worldsOf } from './report.ts';

const REPO = resolve(import.meta.dir, '../../..');
const TIMINGS = '.bun-test-timings.json';
const TAIL_MS = 250;

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('usage: testbed <command> [args...]   runs a test runner on its share of the machine and writes the run report');
  process.exit(2);
}
const vitest = command.some((part) => ['vitest', 'vitest.mjs'].includes(basename(part)));
const bunTest = basename(command[0]!) === 'bun' && command.find((part, index) => index > 0 && !part.startsWith('-')) === 'test';
const runner = bunTest ? 'bun' : vitest ? 'vitest' : 'other';
const budget = budgetOf(coresOf(process.env['TESTBED_CORES']));
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
const named = command.filter((part, index) => index < options() && !part.startsWith('-') && /\.[cm]?[jt]sx?$/.test(part)).length;
const asked = bunTest ? take(/^--parallel$/) : vitest ? take(/^--max(?:Workers|-workers)$/) : undefined;
const concurrency = bunTest ? take(/^--max-concurrency$/) : undefined;
const jobs = process.env['TESTBED_JOBS'] === undefined ? undefined : Number(process.env['TESTBED_JOBS']);
if (jobs !== undefined && (!Number.isSafeInteger(jobs) || jobs < 1)) throw new Error('TESTBED_JOBS must be a positive integer');
const life = process.env['TESTBED_LIFE_MS'] === undefined ? undefined : Number(process.env['TESTBED_LIFE_MS']);
if (life !== undefined && (!Number.isSafeInteger(life) || life < 1)) throw new Error('TESTBED_LIFE_MS must be a positive integer');
const wanted = Math.min(asked ?? budget, jobs ?? budget, bunTest && named > 0 ? named : budget);

const processes = await openProcesses();
const [holderPid, holderStart, holderUnits] = (process.env[SLOT_ENV] ?? '').split(':').map(Number);
const inherited = holderPid !== undefined && holderPid > 0 && processes.facts(holderPid)?.start === holderStart;
const queueBefore = process.cpuUsage();
const units =
  inherited || runner === 'other'
    ? undefined
    : await acquireUnits(budgetRoot(), budget, wanted, process.env[ADMITTED_ENV] === '1', (commands) =>
        console.error(`testbed: all ${budget} processes are held by ${commands} other commands; waiting`),
      );
const queueCpu = process.cpuUsage(queueBefore);
process.once('exit', () => units?.release());
const granted = holderUnits !== undefined && Number.isSafeInteger(holderUnits) && holderUnits > 0 ? holderUnits : 1;
const held = units?.held ?? Math.max(1, Math.min(wanted, granted));
if (bunTest) command.splice(options(), 0, `--parallel=${held}`, `--max-concurrency=${Math.min(held, concurrency ?? held)}`);
if (vitest) command.splice(options(), 0, `--maxWorkers=${held}`);
console.error(
  runner === 'other' && !inherited
    ? `testbed: a ${budget}-process budget; the test runners this command starts take their own shares`
    : `testbed: ${held} of ${inherited ? `${granted} inherited` : budget} processes; queued ${((units?.queued ?? 0) / 1000).toFixed(3)} s`,
);
const holder = inherited
  ? process.env[SLOT_ENV]
  : units === undefined
    ? undefined
    : `${process.pid}:${processes.facts(process.pid)?.start ?? 0}:${held}`;
if (getPriority(process.pid) < NICE) setPriority(process.pid, NICE);
const run = openRun({ pid: process.pid, start: processes.facts(process.pid)?.start ?? 0 });
if (run.fresh) sweepRuns(processes);

if (bunTest) command.push(`--preload=${join(REPO, 'packages/testbed/src/bun.ts')}`);
const option = (prefix: string): string | undefined => command.find((part) => part.startsWith(prefix))?.slice(prefix.length);
const randomize = command.indexOf('--randomize');
let seed: number | undefined;
if (runner === 'bun') {
  const given = option('--seed=');
  seed = given === undefined ? undefined : Number(given);
  if (seed === undefined && randomize !== -1) {
    seed = Math.floor(Math.random() * 2 ** 31);
    command.push(`--seed=${seed}`);
  }
} else if (runner === 'vitest' && randomize !== -1) {
  const given = option('--sequence.seed=');
  seed = given === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(given);
  command.splice(randomize, 1, '--sequence.shuffle', ...(given === undefined ? [`--sequence.seed=${seed}`] : []));
}
const junit = join(run.root, 'junit.xml');
if (bunTest && option('--reporter') === undefined) command.push('--reporter=junit', `--reporter-outfile=${junit}`);
if (bunTest && option('--timings') === undefined) {
  command.push(`--timings=${TIMINGS}`);
  if (option('--shard') === undefined) command.push('--update-timings');
}

const started = Number(process.hrtime.bigint()) / 1e6;
const before = processes.reaped() ?? 0;
const environment: Record<string, string | undefined> = {
  ...process.env,
  [ROOT_ENV]: run.root,
  [REPORT_ENV]: run.report,
  [SLOT_ENV]: holder,
};
delete environment['TESTBED_LIFE_MS'];
delete environment[ADMITTED_ENV];
const child = Bun.spawn(command, {
  stdio: ['inherit', 'inherit', 'inherit', ...(units === undefined ? [] : [units.entry])],
  env: environment,
  ...(life === undefined ? {} : { timeout: life, killSignal: 'SIGTERM' as const }),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
let kept = held;
const seen = new Set<number>();
const tail =
  bunTest && units !== undefined && held > 1
    ? setInterval(() => {
        const workers = processes.children(child.pid).filter((pid) => / --test-worker(?: |$)/.test(processes.command(pid) ?? ''));
        for (const pid of workers) seen.add(pid);
        if (seen.size < held || Math.max(1, workers.length) >= kept) return;
        kept = units.keep(workers.length);
        console.error(`testbed: ${workers.length} workers left; ${kept} of ${held} processes kept`);
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
const worlds = worldsOf(rows.filter((row): row is WorldRow => row.type === 'world' && mine(row)));
const reported = runner === 'bun' && existsSync(junit) ? junitOf(readFileSync(junit, 'utf8'), process.cwd(), REPO) : undefined;
const outcomes = reported === undefined ? { rows: [], unmatched: 0 } : outcomesOf(tests, reported.cases);
const verdicts = reported === undefined ? [] : verdictsOf(files, reported);
const runRow = runOf(
  { root: run.root, runner, command, cwd: process.cwd(), repo: REPO, seed, wall, cpu, queued: units?.queued ?? 0, code: code ?? 1 },
  files,
  tests.length,
  worlds,
);
appendFileSync(
  run.report,
  `${[...outcomes.rows, ...verdicts, ...workersOf(files).map((worker) => ({ ...worker, run: run.root })), runRow].map((row) => JSON.stringify(row)).join('\n')}\n`,
);
console.error(summary(runRow, files, outcomes.unmatched, run.report));
if (seed !== undefined) console.error(`  seed: ${seed}`);
process.exit(code ?? 1);
