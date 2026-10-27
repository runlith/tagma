import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Coverage } from './coverage.ts';
import { Hashes, type Inputs, type Variant } from './inputs.ts';
import type { Load } from './loads.ts';
import { Narrowing } from './narrow.ts';
import type { Package } from './packages.ts';
import { scopeOf } from './scope.ts';
import { budgetOf, coresOf, memoryOf } from '@runlith/testbed/budget';
import { kindOf } from '@runlith/testbed/kinds';
import type { FileRow, Row } from '@runlith/testbed/ledger';
import { slowLine, type FileVerdict, type RunRow, type SlowRow } from '@runlith/testbed/report';
import { runJobs } from '@runlith/testbed/schedule';

const started = performance.now();
const ownCpu = process.cpuUsage();
const TOOLKIT = resolve(import.meta.dir, '../..');
const scope = await scopeOf(process.argv.slice(2), {
  valued: ['--seed', '--adapter', '--report'],
  switches: ['--plan', '--full', '--no-cache', '--isolated'],
  usage:
    'bun run check:change [--base ref | --commit ref | --paths-from file] [--package path] [--file path] [--seed number] [--adapter kind] [--plan] [--no-cache] [--full] [--isolated] [--report file]',
  session: true,
});
const { args, value, root, cache, graph, records, loads, changed, global, session, tests } = scope;
const testbed = existsSync(join(root, 'packages/testbed/src/cli.ts')) ? root : TOOLKIT;
const named = scope.named ?? 'no change';
const all = args.includes('--full');
const selection = all || global !== undefined ? undefined : graph.select(tests, changed);
graph.save();
const narrowing = selection === undefined ? undefined : new Narrowing(graph, new Coverage(cache));
const dropped: { readonly file: string; readonly why: string }[] = [];
type Selected = {
  readonly file: string;
  readonly pkg: Package;
  readonly runner: 'bun' | 'vitest';
  readonly why: string;
  readonly map: string | undefined;
};
const selected = tests
  .flatMap((file): Selected[] => {
    const pkg = graph.package(file);
    const runner = graph.runner(file);
    const why = all
      ? 'full package layers requested'
      : global !== undefined
        ? `shared input changed: ${global}`
        : selection?.selected.get(file);
    if (why === undefined) return [];
    if (narrowing === undefined || runner !== 'bun' || why.startsWith('test changed')) return [{ file, pkg, runner, why, map: undefined }];
    const verdict = narrowing.judge(file, selection!.reached.get(file) ?? []);
    if (verdict.keep) return [{ file, pkg, runner, why, map: verdict.why }];
    dropped.push({ file, why: verdict.why });
    return [];
  })
  .sort((a, b) => a.file.localeCompare(b.file));
dropped.sort((a, b) => a.file.localeCompare(b.file));
const counts =
  selection === undefined
    ? { imports: tests.length, untraced: undefined, dropped: 0 }
    : { imports: selection.imports, untraced: selection.untraced, dropped: dropped.length };
if (session !== undefined && changed.length === 0)
  console.error(
    `check:change: session ${session.session} holds no uncommitted lines in ${root}; name landed work with --commit <ref>, or other paths with --paths-from <file>`,
  );
const variant: Variant = {
  seed: Number(value('--seed') ?? 0),
  adapter: value('--adapter') ?? 'default',
  isolated: args.includes('--isolated'),
};
if (!Number.isInteger(variant.seed) || variant.seed < 0 || variant.seed > 2 ** 32 - 1) throw new Error('--seed must be a uint32');
const tool = (name: string): string => {
  const result = Bun.spawnSync([name, '--version'], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`Cannot read ${name} version: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};
if (args.includes('--plan')) {
  console.log(
    JSON.stringify(
      {
        base: named,
        changed,
        seed: variant.seed,
        adapter: variant.adapter,
        counts,
        selected: selected.map((item) => ({ file: item.file, runner: item.runner, package: item.pkg.dir, why: item.why, map: item.map })),
        dropped,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const hashes = new Hashes(graph, [Bun.version, tool('git'), tool('cargo'), process.platform, process.arch], variant);
const run = join(cache, randomUUID());
mkdirSync(run);
type Previous = { readonly code: number; readonly wall: number; readonly cpu: number; readonly reason?: string; readonly bypass?: string };
type Planned = (typeof selected)[number] & {
  readonly inputs: Inputs;
  readonly cached: boolean;
  readonly bypass: string | undefined;
  readonly previous: Previous | undefined;
};
const plans: Planned[] = selected.map((item) => {
  const inputs = hashes.of(item.file);
  const previous = records.read<Previous>(inputs.key);
  const bypass = args.includes('--no-cache')
    ? 'cache bypass requested'
    : variant.adapter !== 'default'
      ? `adapter label ${variant.adapter} disables reuse`
      : (inputs.uncertain[0] ?? previous?.bypass);
  return { ...item, inputs, previous, bypass, cached: bypass === undefined && previous?.code === 0 };
});
const output = plans.map((plan) => ({
  file: plan.file,
  runner: plan.runner,
  package: plan.pkg.dir,
  action: plan.cached ? 'cache' : 'run',
  why: plan.cached
    ? 'same input hash'
    : (plan.bypass ?? (plan.previous === undefined ? 'input hash has no result' : 'previous run failed')),
  selected: plan.why,
  key: plan.inputs.key,
}));
console.log(
  `check:change: ${plans.length} files selected, ${dropped.length} dropped by coverage maps; base ${named}, seed ${variant.seed}, adapter ${variant.adapter}`,
);
for (const row of dropped) console.log(`dropped ${row.file}: ${row.why}`);
for (const row of output) console.log(`${row.action} ${row.file}: ${row.why}; ${row.selected}`);
let cpu = 0;
let code = 0;
let ran = 0;
let notRun = 0;
const groups = new Map<string, Planned[]>();
for (const plan of plans.filter((plan) => !plan.cached)) {
  const key = `${plan.pkg.dir}\0${plan.runner}\0${kindOf(plan.file)}`;
  const group = groups.get(key) ?? [];
  group.push(plan);
  groups.set(key, group);
}
const budget = budgetOf(coresOf(process.env['TESTBED_CORES']), memoryOf());
const suites = [...groups.values()].sort(
  (a, b) =>
    b.reduce((total, plan) => total + (plan.previous?.cpu ?? 0), 0) - a.reduce((total, plan) => total + (plan.previous?.cpu ?? 0), 0),
);
type Outcome = {
  readonly exit: number;
  readonly rows: readonly Row[];
  readonly issues: readonly { readonly file: string; readonly reason: string }[];
  readonly loads: readonly Load[];
};
type Audited = { readonly type: 'input'; readonly file: string; readonly reason: string } | Load;
const outcomes = new Map<string, Outcome>();
const jobs = suites.map((suite, at) => {
  const pkg = suite[0]!.pkg;
  const runnerKind = suite[0]!.runner;
  const report = join(run, `${at}.jsonl`);
  const audit = join(run, `${at}.audit.jsonl`);
  const manifest = join(run, `${at}.inputs.json`);
  writeFileSync(
    manifest,
    JSON.stringify({
      root,
      report: audit,
      runner: runnerKind,
      importers: [...new Set(suite.flatMap((plan) => plan.inputs.importers))].map((path) => ({ path, literal: graph.literal(path) })),
      entries: suite.map((plan) => ({
        file: plan.file,
        packages: plan.inputs.packages.filter((dir) => dir !== ''),
        files: plan.inputs.files,
      })),
    }),
  );
  const local = suite.map((plan) => `./${relative(pkg.dir === '' ? root : join(root, pkg.dir), join(root, plan.file))}`);
  const config = ['vitest.config.ts', 'vite.config.ts', 'vitest.config.js', 'vite.config.js']
    .map((name) => join(root, pkg.dir, name))
    .find(existsSync);
  if (runnerKind === 'vitest' && config === undefined) throw new Error(`No Vitest config for ${pkg.dir}`);
  const runner =
    runnerKind === 'bun'
      ? [
          process.execPath,
          'test',
          '--no-orphans',
          variant.isolated ? '--isolate' : '--no-isolate',
          `--preload=${join(TOOLKIT, 'scripts/change/testing/trace.ts')}`,
          `--seed=${variant.seed}`,
          ...local,
        ]
      : [
          process.execPath,
          '--bun',
          'x',
          '--no-install',
          'vitest',
          'run',
          '--config',
          join(TOOLKIT, 'scripts/change/vitest.ts'),
          `--sequence.seed=${variant.seed}`,
          ...(variant.isolated ? ['--isolate'] : []),
          ...local,
        ];
  return {
    id: String(at),
    cwd: join(root, pkg.dir),
    stages: [[process.execPath, join(testbed, 'packages/testbed/src/cli.ts'), ...runner]],
    need: suite.length,
    env: { ...process.env, RUNLITH_TEST_REPORT: report, RUNLITH_CHANGE_AUDIT: manifest, RUNLITH_CHANGE_CONFIG: config },
  };
});
const lines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
await runJobs(jobs, {
  budget,
  serial: false,
  ended: (job, ending) => {
    const log = join(run, `${job.id}.log`);
    writeFileSync(log, ending.stdout + ending.stderr);
    const audited = lines(join(run, `${job.id}.audit.jsonl`)).map((line) => JSON.parse(line) as Audited);
    outcomes.set(job.id, {
      exit: ending.exit,
      rows: lines(join(run, `${job.id}.jsonl`)).map((line) => JSON.parse(line) as Row),
      issues: audited.filter((row) => row.type === 'input'),
      loads: audited.filter((row) => row.type === 'load'),
    });
    const failed = (ending.stdout + ending.stderr).split('\n').filter((line) => line.startsWith('(fail)'));
    const suite = suites[Number(job.id)]!;
    console.log(
      `check:change: ${suite[0]!.pkg.dir || '.'} ${suite[0]!.runner}, ${suite.length} files: exit ${ending.exit}; ${log}${failed.map((line) => `\n  ${line}`).join('')}`,
    );
  },
});
const after = new Hashes(graph, hashes.versions, variant);
const settled: {
  readonly plan: Planned;
  readonly row: FileRow | undefined;
  readonly problem: string | undefined;
  readonly skipped: string | undefined;
  readonly issue: string | undefined;
}[] = [];
const traced = new Map<string, Readonly<Record<string, string>>>();
const cleared: string[] = [];
for (const [at, suite] of suites.entries()) {
  const outcome = outcomes.get(String(at));
  const exit = outcome?.exit ?? 1;
  if (exit !== 0) code = exit || 1;
  const rows = outcome?.rows ?? [];
  const runRow = rows.findLast((row): row is RunRow => row.type === 'run');
  const fileRows = new Map(
    rows.filter((row): row is FileRow => row.type === 'file').map((row) => [resolve(testbed, row.file), row] as const),
  );
  const verdicts = new Map(
    rows.filter((row): row is FileVerdict => row.type === 'file-verdict').map((row) => [`${row.file}\0${row.run}`, row] as const),
  );
  const runnerKind = suite[0]!.runner;
  cpu += runRow?.cpu ?? 0;
  const undeclared = new Map<string, string>();
  for (const load of outcome?.loads ?? []) {
    const declared = graph.declared(load.importer);
    if (declared !== undefined && !declared.includes(load.target))
      undeclared.set(
        load.file,
        `${load.importer} loaded ${load.target}, which changeCheck.loads in ${graph.package(load.importer).manifest} does not declare`,
      );
  }
  for (const plan of suite) {
    const row = fileRows.get(join(root, plan.file));
    const stable = after.of(plan.file).key === plan.inputs.key;
    const verdict = row === undefined ? undefined : verdicts.get(`${row.file}\0${row.run}`);
    const passed = runnerKind === 'bun' ? verdict?.outcome === 'pass' : exit === 0;
    const skipped = verdict?.outcome === 'skip' ? verdict.reason || 'all tests were skipped' : undefined;
    const problem =
      row === undefined
        ? 'runner produced no report for the selected file'
        : row.residue !== 0
          ? 'the file left processes behind'
          : !passed && skipped === undefined
            ? 'runner did not prove a passing file'
            : !stable
              ? 'inputs changed during the run'
              : undeclared.get(plan.file);
    if (problem === undefined && skipped === undefined && runnerKind === 'bun')
      traced.set(plan.file, Object.fromEntries(plan.inputs.importers.map((importer) => [importer, graph.stamp(importer)])));
    else if (row !== undefined) cleared.push(plan.file);
    settled.push({ plan, row, problem, skipped, issue: outcome?.issues.find((issue) => issue.file === plan.file)?.reason });
  }
}
loads.record(
  [...outcomes.values()].flatMap((outcome) => outcome.loads),
  traced,
  cleared,
  (path) => graph.stamp(path),
);
for (const { plan, row, problem, skipped, issue } of settled) {
  const inputs = after.of(plan.file);
  const grown = inputs.packages.find((dir) => !plan.inputs.packages.includes(dir));
  const reason =
    inputs.uncertain[0] ?? issue ?? (grown === undefined ? undefined : `traced loads reach package ${grown || '.'}, unread before the run`);
  const result = {
    code: problem === undefined ? 0 : 1,
    wall: row?.total?.wall ?? 0,
    cpu: row?.total?.cpu ?? 0,
    reason: problem ?? skipped ?? reason,
    bypass: skipped ?? reason,
  };
  const isSkipped = skipped !== undefined && problem === undefined;
  if (result.code !== 0) code = code || 1;
  if (isSkipped) notRun++;
  else if (row !== undefined) ran++;
  if (!args.includes('--no-cache') && variant.adapter === 'default') records.write(inputs.key, result);
  console.log(
    isSkipped
      ? `not run ${plan.file}: ${skipped}; not cached`
      : `${row === undefined ? 'unproved' : 'ran'} ${plan.file}: ${result.code === 0 ? 'pass' : 'not cached'}${result.reason === undefined ? '' : `; ${result.reason}`}`,
  );
}
const slow = [...outcomes.values()]
  .flatMap((outcome) => outcome.rows.filter((row): row is SlowRow => row.type === 'slow'))
  .sort((left, right) => right.wall - left.wall);
if (slow.length > 0) {
  console.log(`check:change: ${slow.length} slow tests; the cause is each test's own cost:`);
  for (const row of slow) console.log(`  slow ${slowLine(row)}`);
}
const spent = process.cpuUsage(ownCpu);
cpu += (spent.user + spent.system) / 1000;
const result = {
  selected: plans.length,
  ran,
  skipped: notRun,
  cached: plans.filter((plan) => plan.cached).length,
  wall: Math.round(performance.now() - started),
  cpu,
  code,
  base: named,
  seed: variant.seed,
  adapter: variant.adapter,
  files: output,
  dropped,
  slow,
  reports: run,
};
const report = value('--report');
if (report !== undefined) writeFileSync(resolve(report), JSON.stringify(result, null, 2));
console.log(
  `check:change: ${ran} ran, ${notRun} not run, ${result.cached} cached; wall ${(result.wall / 1000).toFixed(2)} s, cpu ${(cpu / 1000).toFixed(2)} s; ${run}`,
);
process.exitCode = code;
