import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Graph, testFile } from './graph.ts';
import { workspacePaths } from './packages.ts';
import { Hashes, type Inputs, type Variant } from './inputs.ts';
import { Records } from './records.ts';
import type { FileRow, Row } from '@runlith/testbed/ledger';
import type { FileVerdict, RunRow } from '@runlith/testbed/report';

const started = performance.now();
const ownCpu = process.cpuUsage();
const TOOLKIT = resolve(import.meta.dir, '../..');
const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const flags = new Set([
  '--root',
  '--base',
  '--commit',
  '--paths-from',
  '--seed',
  '--adapter',
  '--package',
  '--file',
  '--shard',
  '--report',
]);
for (let at = 0; at < args.length; at++) {
  if (flags.has(args[at]!)) {
    if (args[at + 1] === undefined || args[at + 1]!.startsWith('--')) throw new Error(`${args[at]} needs a value`);
    at++;
  } else if (!['--plan', '--full', '--no-cache', '--isolated', '--help'].includes(args[at]!))
    throw new Error(`Unknown option: ${args[at]}`);
}
if (args.includes('--help')) {
  console.log(
    'bun run check:change [--base ref | --commit ref | --paths-from file] [--package path] [--file path] [--shard k/n] [--seed number] [--adapter kind] [--plan] [--no-cache] [--full] [--isolated] [--report file]',
  );
  process.exit(0);
}
const root = resolve(value('--root') ?? process.cwd());
const git = (...command: string[]): string => {
  const result = Bun.spawnSync(['git', '-C', root, ...command], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${command.join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};
const split = (text: string): string[] => text.split('\0').filter(Boolean);
const tracked = workspacePaths(root);
const cards = split(git('grep', '--untracked', '-z', '-l', '-F', 'tags: ["module"]', '--', '.tagma')).filter((path) =>
  path.endsWith('.md'),
);
const declared = existsSync(join(root, 'tagma.config.ts'))
  ? ((await import(join(root, 'tagma.config.ts'))) as { readonly default: import('@runlith/tagma/rules').Config }).default
  : undefined;
const inspection = declared?.inspections?.modules;
const built =
  inspection !== undefined && 'builtin' in inspection && inspection.builtin === 'modules'
    ? ((inspection.params as import('@runlith/tagma/rules').ModulesParams).built ?? [])
    : [];
const identity = createHash('sha256')
  .update(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim())
  .digest('hex')
  .slice(0, 16);
const cache = join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'runlith', 'change-check', identity);
mkdirSync(cache, { recursive: true });
const records = new Records(cache);
const graph = new Graph(root, tracked, cards, new Map(built.map((entry) => [entry.output, entry.source])), records);
const commit = value('--commit');
const askedBase = value('--base');
if ([commit, askedBase, value('--paths-from')].filter((one) => one !== undefined).length > 1)
  throw new Error('Choose one of --base, --commit or --paths-from');
let base = askedBase;
if (base === undefined && commit === undefined && value('--paths-from') === undefined) {
  const branch = git('branch', '--show-current').trim();
  const main = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master')
    .trim()
    .split('\n')
    .filter(Boolean)[0];
  base = main !== undefined && branch !== '' && branch !== main ? git('merge-base', 'HEAD', main).trim() : 'HEAD';
}
let changed =
  commit !== undefined
    ? split(git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit))
    : value('--paths-from') !== undefined
      ? readFileSync(resolve(value('--paths-from')!), 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
      : [...split(git('diff', '--name-only', '-z', base!)), ...split(git('ls-files', '-z', '--others', '--exclude-standard'))];
changed = [...new Set(changed)].filter((path) => !path.startsWith('archive/'));
const affected = graph.affected(changed);
const all = args.includes('--full');
const global = changed.find(
  (path) =>
    /^(?:bun\.lock|bunfig\.toml|Cargo\.lock|tagma\.config\.ts)$/.test(path) ||
    path.startsWith('packages/testbed/') ||
    path.startsWith('patches/') ||
    path.includes('/drizzle/') ||
    (path.startsWith('.tagma/') && cards.includes(path)),
);
const tests = [...graph.files]
  .filter(testFile)
  .filter((file) => value('--package') === undefined || graph.package(file).dir === value('--package')!.replace(/\/$/, ''))
  .filter((file) => value('--file') === undefined || file === value('--file'));
const selection = all || global !== undefined ? undefined : graph.select(tests, changed);
graph.save();
const shard = value('--shard')?.match(/^(\d+)\/(\d+)$/);
if (
  value('--shard') !== undefined &&
  (shard === null || shard === undefined || Number(shard[1]) < 1 || Number(shard[1]) > Number(shard[2]) || Number(shard[2]) < 1)
)
  throw new Error('--shard must be k/n with 1 <= k <= n');
if (value('--file') !== undefined && !tests.includes(value('--file')!)) throw new Error(`No test file in scope: ${value('--file')}`);
if (value('--package') !== undefined && !graph.packages.some((pkg) => pkg.dir === value('--package')!.replace(/\/$/, '')))
  throw new Error(`No workspace package: ${value('--package')}`);
const selected = tests
  .flatMap((file) => {
    const pkg = graph.package(file);
    const why = all
      ? 'full package layers requested'
      : global !== undefined
        ? `shared input changed: ${global}`
        : selection?.selected.get(file);
    return why === undefined ? [] : [{ file, pkg, runner: graph.runner(file), why }];
  })
  .sort((a, b) => a.file.localeCompare(b.file))
  .filter((_, at) => shard === undefined || shard === null || at % Number(shard[2]) === Number(shard[1]) - 1);
const counts =
  selection === undefined
    ? { cards: tests.filter((file) => affected.has(graph.owner(file)?.block ?? '')).length, imports: tests.length, runtime: undefined }
    : { cards: selection.cards, imports: selection.imports, runtime: selection.runtime };
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
        base: commit ?? base ?? 'named paths',
        changed,
        seed: variant.seed,
        adapter: variant.adapter,
        counts,
        selected: selected.map((item) => ({ file: item.file, runner: item.runner, package: item.pkg.dir, why: item.why })),
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
  `check:change: ${plans.length} files selected; base ${commit ?? base ?? 'named paths'}, seed ${variant.seed}, adapter ${variant.adapter}`,
);
for (const row of output) console.log(`${row.action} ${row.file}: ${row.why}; ${row.selected}`);
const waiting = plans.filter((plan) => !plan.cached).sort((a, b) => (b.previous?.wall ?? 0) - (a.previous?.wall ?? 0));
let cpu = 0;
let code = 0;
let ran = 0;
const groups = new Map<string, Planned[]>();
for (const plan of waiting) {
  const key = `${plan.pkg.dir}\0${plan.runner}`;
  const group = groups.get(key) ?? [];
  group.push(plan);
  groups.set(key, group);
}
for (const group of groups.values()) {
  const pkg = group[0]!.pkg;
  const runnerKind = group[0]!.runner;
  const report = join(run, `${ran}.jsonl`);
  const audit = join(run, `${ran}.audit.jsonl`);
  const manifest = join(run, `${ran}.inputs.json`);
  writeFileSync(
    manifest,
    JSON.stringify({
      root,
      report: audit,
      runner: runnerKind,
      entries: group.map((plan) => ({
        file: plan.file,
        packages: plan.inputs.packages.filter((dir) => dir !== ''),
        files: plan.inputs.files,
      })),
    }),
  );
  const local = group.map((plan) => `./${relative(pkg.dir === '' ? root : join(root, pkg.dir), join(root, plan.file))}`);
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
          '--parallel=1',
          variant.isolated ? '--isolate' : '--no-isolate',
          `--preload=${join(TOOLKIT, 'packages/testbed/src/bun.ts')}`,
          `--preload=${join(TOOLKIT, 'scripts/change/testing/trace.ts')}`,
          `--seed=${variant.seed}`,
          `--timings=${join(cache, 'timings.json')}`,
          '--update-timings',
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
          '--maxWorkers=1',
          '--no-file-parallelism',
          `--sequence.seed=${variant.seed}`,
          ...(variant.isolated ? ['--isolate'] : []),
          ...local,
        ];
  const remaining = 540_000 - (performance.now() - started);
  if (remaining <= 0) throw new Error('check:change reached its nine-minute execution budget; narrow with --package');
  const command = [process.execPath, join(TOOLKIT, 'packages/testbed/src/cli.ts'), ...runner];
  const child = Bun.spawn(command, {
    cwd: join(root, pkg.dir),
    stdio: ['inherit', 'inherit', 'inherit'],
    timeout: Math.floor(Math.min(300_000, remaining)),
    env: { ...process.env, RUNLITH_TEST_REPORT: report, RUNLITH_CHANGE_AUDIT: manifest, RUNLITH_CHANGE_CONFIG: config },
  });
  const stop = (): void => {
    child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const exit = await child.exited;
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  if (exit !== 0) code = exit || 1;
  const rows = existsSync(report)
    ? readFileSync(report, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row)
    : [];
  const issues = existsSync(audit)
    ? readFileSync(audit, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { readonly file: string; readonly reason: string })
    : [];
  const runRow = rows.findLast((row): row is RunRow => row.type === 'run');
  const fileRows = rows.filter((row): row is FileRow => row.type === 'file');
  cpu += runRow?.cpu ?? 0;
  const after = new Hashes(graph, hashes.versions, variant);
  for (const plan of group) {
    const row = fileRows.find((row) => resolve(TOOLKIT, row.file) === join(root, plan.file));
    const reason = plan.bypass ?? issues.find((issue) => issue.file === plan.file)?.reason;
    const stable = after.of(plan.file).key === plan.inputs.key;
    const verdict = rows.find(
      (entry): entry is FileVerdict => entry.type === 'file-verdict' && entry.file === row?.file && entry.run === row?.run,
    );
    const passed = runnerKind === 'bun' ? verdict?.outcome === 'pass' : exit === 0;
    const problem =
      row === undefined
        ? 'runner produced no report for the selected file'
        : row.residue !== 0
          ? 'the file left processes behind'
          : !passed
            ? 'runner did not prove a passing file'
            : !stable
              ? 'inputs changed during the run'
              : undefined;
    const result = {
      code: problem === undefined ? 0 : 1,
      wall: row?.total?.wall ?? 0,
      cpu: row?.total?.cpu ?? 0,
      reason: problem ?? reason,
      bypass: reason,
    };
    if (result.code !== 0) code = code || 1;
    if (row !== undefined) ran++;
    if (!args.includes('--no-cache') && variant.adapter === 'default') records.write(plan.inputs.key, result);
    console.log(
      `${row === undefined ? 'unproved' : 'ran'} ${plan.file}: ${result.code === 0 ? 'pass' : 'not cached'}${result.reason === undefined ? '' : `; ${result.reason}`}`,
    );
  }
}
const spent = process.cpuUsage(ownCpu);
cpu += (spent.user + spent.system) / 1000;
const result = {
  selected: plans.length,
  ran,
  cached: plans.filter((plan) => plan.cached).length,
  wall: Math.round(performance.now() - started),
  cpu,
  code,
  base: commit ?? base ?? 'named paths',
  seed: variant.seed,
  adapter: variant.adapter,
  files: output,
  reports: run,
};
const report = value('--report');
if (report !== undefined) writeFileSync(resolve(report), JSON.stringify(result, null, 2));
console.log(
  `check:change: ${ran} ran, ${result.cached} cached; wall ${(result.wall / 1000).toFixed(2)} s, cpu ${(cpu / 1000).toFixed(2)} s; ${run}`,
);
process.exitCode = code;
