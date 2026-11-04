import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { FileRow, Row } from '@runlith/testbed/ledger';
import type { FileVerdict, OutcomeRow, RunRow } from '@runlith/testbed/report';
import { machineBudget } from '@runlith/testbed/budget';
import { runJobs, type Ended } from '@runlith/testbed/schedule';
import { packagesOf, workspacePaths } from './packages.ts';
import { SCRIPTS, suitesOf, type Suite } from './suites.ts';

const started = performance.now();
const own = process.cpuUsage();
const args = process.argv.slice(2);
const values = new Set(['--root', '--jobs', '--seed', '--package', '--script', '--report', '--history', '--max-suites']);
for (let at = 0; at < args.length; at++) {
  if (values.has(args[at]!)) {
    if (args[at + 1] === undefined || args[at + 1]!.startsWith('--')) throw new Error(`${args[at]} needs a value`);
    at++;
  } else if (!['--randomize', '--resume', '--plan', '--help'].includes(args[at]!)) throw new Error(`Unknown option: ${args[at]}`);
}
const value = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (args.includes('--help')) {
  console.log(
    `bun run test:all [--jobs cap] [--randomize] [--seed uint32] [--package path] [--script ${SCRIPTS.join('|')}] [--report file] [--resume] [--history earlier-report] [--max-suites count] [--plan]`,
  );
  process.exit(0);
}
const root = resolve(value('--root') ?? process.cwd());
const toolkit = resolve(import.meta.dir, '../..');
const jobs = value('--jobs') === undefined ? undefined : Number(value('--jobs'));
const seed = value('--seed') === undefined ? undefined : Number(value('--seed'));
if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1)) throw new Error('--seed must be a uint32');
const limit = Number(value('--max-suites') ?? Infinity);
if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error('--max-suites must be a positive integer');
const script = value('--script');
if (script !== undefined && !SCRIPTS.some((one) => one === script)) throw new Error(`--script must be one of ${SCRIPTS.join(', ')}`);
const paths = workspacePaths(root);
const packages = packagesOf(paths, (path) => readFileSync(join(root, path), 'utf8'));
if (value('--package') !== undefined && !packages.some((pkg) => (pkg.dir || '.') === value('--package')))
  throw new Error(`No workspace package: ${value('--package')}`);
const report = resolve(
  value('--report') ?? join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'runlith', 'test-all', `${randomUUID()}.json`),
);
const artifacts = `${report}.d`;
let suites = suitesOf(packages, paths, {
  root: toolkit,
  jobs,
  seed,
  randomize: args.includes('--randomize'),
  reports: artifacts,
  combineVitest: value('--package') === undefined,
})
  .filter((suite) => value('--package') === undefined || (suite.directory || '.') === value('--package'))
  .filter((suite) => script === undefined || suite.script === script);
if (args.includes('--plan')) {
  console.log(JSON.stringify(suites, null, 2));
  process.exit(0);
}
type Result = {
  readonly id: string;
  readonly directory: string;
  readonly script: string;
  readonly command: string;
  readonly wall: number;
  readonly cpu: number;
  readonly queued: number;
  readonly unmeasured: boolean;
  readonly skipped: string | undefined;
  readonly code: number;
  readonly files: number;
  readonly tests: number;
  readonly failed: readonly string[];
  readonly report: string;
  readonly log: string;
};
type Reading = {
  readonly root: string;
  readonly jobs: number | undefined;
  readonly randomize: boolean;
  readonly seed: number | undefined;
  readonly wall: number;
  readonly cpu: number;
  readonly complete: boolean;
  readonly pending: readonly string[];
  readonly suites: readonly Result[];
  readonly plan: readonly Suite[];
  readonly aborted: readonly Result[];
};
const previous = args.includes('--resume') ? (JSON.parse(readFileSync(report, 'utf8')) as Reading) : undefined;
if (previous !== undefined && (previous.root !== root || previous.randomize !== args.includes('--randomize') || previous.seed !== seed))
  throw new Error('--resume must use the same root, randomize and seed as its report');
if (previous === undefined && existsSync(report)) throw new Error(`Report already exists; use --resume or a new --report: ${report}`);
if (previous !== undefined)
  suites = previous.plan.map((suite) =>
    previous.suites.some((result) => result.id === suite.id && result.code !== 143 && result.code !== 137)
      ? suite
      : {
          ...suite,
          stages:
            jobs === undefined ? suite.stages : suite.stages.map((stage) => stage.replace(/--test-threads=\d+/g, `--test-threads=${jobs}`)),
        },
  );
mkdirSync(dirname(report), { recursive: true });
mkdirSync(artifacts, { recursive: true });
const cut = (code: number): boolean => code === 143 || code === 137;
const results: Result[] = (previous?.suites ?? []).filter((result) => !cut(result.code));
let aborted: Result[] = [...(previous?.aborted ?? []), ...(previous?.suites ?? []).filter((result) => cut(result.code))];
const done = new Set(results.map((result) => result.id));
const solo = new Set<string>();
const settled = results.length;
const stopped = aborted.length;
const save = (): Reading => {
  const spent = process.cpuUsage(own);
  const pending = suites.filter((suite) => !done.has(suite.id)).map((suite) => suite.id);
  const reading: Reading = {
    root,
    jobs,
    randomize: args.includes('--randomize'),
    seed,
    wall:
      (previous?.wall ?? 0) +
      performance.now() -
      started -
      [...results.slice(settled), ...aborted.slice(stopped)]
        .filter((result) => solo.has(result.id))
        .reduce((total, result) => total + result.queued, 0),
    cpu:
      [...results, ...aborted].reduce((total, result) => total + result.cpu, 0) +
      (previous === undefined
        ? 0
        : previous.cpu - [...previous.suites, ...(previous.aborted ?? [])].reduce((total, result) => total + result.cpu, 0)) +
      (spent.user + spent.system) / 1000,
    complete: pending.length === 0,
    pending,
    suites: results,
    plan: suites,
    aborted,
  };
  writeFileSync(report, JSON.stringify(reading, null, 2));
  return reading;
};
const budget = machineBudget(process.env);
const history = value('--history') === undefined ? undefined : resolve(value('--history')!);
const earlier = history === undefined || !existsSync(history) ? undefined : (JSON.parse(readFileSync(history, 'utf8')) as Reading);
const spent = new Map<string, number>();
const sized = new Map<string, number>();
for (const result of [...(earlier?.suites ?? []), ...(earlier?.aborted ?? [])]) {
  spent.set(result.id, Math.max(spent.get(result.id) ?? 0, result.cpu));
  sized.set(result.id, Math.max(sized.get(result.id) ?? 0, result.files));
}
const costOf = (suite: Suite): number => spent.get(suite.id) ?? 0;
const needOf = (suite: Suite): number => Math.max(1, Math.min(suite.files ?? sized.get(suite.id) ?? budget, budget));
const ledgerOf = (suite: Suite): string => join(artifacts, `${encodeURIComponent(suite.id)}.jsonl`);
const logOf = (suite: Suite): string => join(artifacts, `${encodeURIComponent(suite.id)}.log`);
const byId = new Map(suites.map((suite) => [suite.id, suite]));
const begun = new Map<string, number>();
const logs = new Map<string, number>();
try {
  await runJobs(
    suites
      .filter((suite) => !done.has(suite.id))
      .sort((a, b) => costOf(b) - costOf(a))
      .map((suite) => ({
        id: suite.id,
        cwd: join(root, suite.directory),
        stages: suite.stages.map((stage) => ['/bin/sh', '-c', `exec ${stage}`]),
        need: needOf(suite),
        env: {
          ...process.env,
          RUNLITH_TEST_REPORT: ledgerOf(suite),
          ...(jobs === undefined ? {} : { TESTBED_JOBS: String(jobs) }),
          PATH: `${join(root, suite.directory, 'node_modules/.bin')}:${join(toolkit, 'node_modules/.bin')}:${process.env['PATH'] ?? ''}`,
        },
      })),
    {
      budget,
      serial: jobs !== undefined,
      limit,
      started: (job) => prepare(byId.get(job.id)!),
      output: (job, chunk) => appendFileSync(logs.get(job.id)!, chunk),
      ended: (job, run) => settle(byId.get(job.id)!, run),
    },
  );
} finally {
  for (const log of logs.values()) closeSync(log);
  logs.clear();
}

function prepare(suite: Suite): void {
  const ledger = ledgerOf(suite);
  const log = logOf(suite);
  if (existsSync(ledger) && !aborted.some((result) => result.report === ledger)) {
    const rows = readFileSync(ledger, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row | RunRow);
    const run = rows.findLast((row): row is RunRow => row.type === 'run');
    if (run !== undefined && cut(run.code))
      aborted.push({
        id: suite.id,
        directory: suite.directory,
        script: suite.script,
        command: run.command,
        wall: run.wall,
        cpu: run.cpu,
        queued: run.queued,
        unmeasured: false,
        skipped: undefined,
        code: run.code,
        files: run.files,
        tests: run.tests,
        failed: [],
        report: ledger,
        log,
      });
  }
  for (const path of [ledger, log, ...suite.outputs])
    if (existsSync(path)) {
      const archived = `${path}.interrupted-${randomUUID()}`;
      renameSync(path, archived);
      aborted = aborted.map((result) => ({
        ...result,
        report: result.report === path ? archived : result.report,
        log: result.log === path ? archived : result.log,
      }));
    }
  logs.set(suite.id, openSync(log, 'w'));
  console.log(`test:all: ${suite.id}`);
  begun.set(suite.id, performance.now());
}

function settle(suite: Suite, run: Ended): void {
  const { stdout, stderr, exit, interrupted } = run;
  const ledger = ledgerOf(suite);
  const log = logOf(suite);
  closeSync(logs.get(suite.id)!);
  logs.delete(suite.id);
  const before = begun.get(suite.id)!;
  if (run.alone) solo.add(suite.id);
  const rows = existsSync(ledger)
    ? readFileSync(ledger, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row | FileVerdict | OutcomeRow | RunRow)
    : [];
  const runs = rows.filter((row): row is RunRow => row.type === 'run');
  const files = rows.filter((row): row is FileRow => row.type === 'file');
  const failed = new Set(
    rows.filter((row): row is FileVerdict => row.type === 'file-verdict' && row.outcome === 'fail').map((row) => row.file),
  );
  for (const file of files) if (file.residue !== 0) failed.add(file.file);
  for (const output of suite.outputs) {
    if (!existsSync(output)) continue;
    const vitest = JSON.parse(readFileSync(output, 'utf8')) as { testResults?: readonly { name: string; status: string }[] };
    for (const file of vitest.testResults ?? []) if (file.status === 'failed') failed.add(file.name);
  }
  const missing = runs.length === 0;
  const result: Result = {
    id: suite.id,
    directory: suite.directory,
    script: suite.script,
    command: suite.stages.join(' && '),
    wall: performance.now() - before - runs.reduce((total, run) => total + run.queued, 0),
    cpu: runs.reduce((total, run) => total + run.cpu, 0),
    queued: runs.reduce((total, run) => total + run.queued, 0),
    unmeasured: missing,
    skipped: /^SKIP .*$/m.exec(stdout + stderr)?.[0],
    code: missing ? exit || 1 : exit,
    files: files.length,
    tests: runs.reduce((total, run) => total + run.tests, 0),
    failed: [...failed].sort(),
    report: ledger,
    log,
  };
  if (cut(result.code) || interrupted) aborted.push(result);
  else {
    results.push(result);
    done.add(suite.id);
  }
  save();
  if (interrupted) return;
  console.log(
    `test:all: ${suite.id} ${cut(result.code) ? 'CUT' : result.code === 0 ? 'pass' : 'FAIL'}: wall ${(result.wall / 1000).toFixed(2)} s, cpu ${(result.cpu / 1000).toFixed(2)} s; ${result.files} files, ${result.tests} tests`,
  );
  if (result.skipped !== undefined) console.log(`  ${result.skipped}`);
  for (const file of result.failed) console.log(`  red: ${file}`);
  if (result.code !== 0 && result.failed.length === 0)
    console.log(`  failure before a file verdict; ${log}\n${(stdout + stderr).slice(-3000)}`);
}
const reading = save();
const groups = new Map<string, Result[]>();
for (const result of [...aborted, ...results]) {
  const group = groups.get(result.id) ?? [];
  group.push(result);
  groups.set(result.id, group);
}
const table = ['suite\twall_s\tcpu_s\tqueued_s\tfile_runs\ttests\tstatus'];
for (const [name, group] of groups)
  table.push(
    [
      name,
      (group.reduce((n, row) => n + row.wall, 0) / 1000).toFixed(2),
      (group.reduce((n, row) => n + row.cpu, 0) / 1000).toFixed(2),
      (group.reduce((n, row) => n + row.queued, 0) / 1000).toFixed(2),
      group.reduce((n, row) => n + row.files, 0),
      group.reduce((n, row) => n + row.tests, 0),
      group.some((row) => row.code !== 0 && !cut(row.code))
        ? 'FAIL'
        : !done.has(name)
          ? group.some((row) => cut(row.code))
            ? 'cut'
            : 'partial'
          : group.every((row) => row.skipped !== undefined)
            ? 'skip'
            : 'pass',
    ].join('\t'),
  );
writeFileSync(`${report}.tsv`, `${table.join('\n')}\n`);
console.log(table.join('\n'));
const unmeasured = [...results, ...aborted].filter((result) => result.unmeasured).length;
if (aborted.length > 0)
  console.log(`  ${aborted.length} interrupted attempts are included in cost and file_runs; their unfinished suites stay pending.`);
if (unmeasured > 0) console.log(`  ${unmeasured} attempts produced no CPU report; CPU is a measured subtotal, not the whole cost.`);
console.log(
  `test:all: ${reading.complete ? 'complete' : `${reading.pending.length} suites pending`}; wall ${(reading.wall / 1000).toFixed(2)} / 120 s, cpu ${(reading.cpu / 1000).toFixed(2)} / 360 s; ${report}`,
);
for (const result of results) for (const file of result.failed) console.log(`red: ${file}`);
if (!reading.complete)
  console.log(
    `Resume: bun run test:all --report '${report}' --resume${args.includes('--randomize') ? ' --randomize' : ''}${seed === undefined ? '' : ` --seed ${seed}`}${jobs === undefined ? '' : ` --jobs ${jobs}`}`,
  );
process.exitCode = results.some((row) => row.code !== 0) ? 1 : reading.complete ? 0 : 2;
