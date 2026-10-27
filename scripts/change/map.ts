import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Batch, Coverage, rangesOf, type Loaded } from './coverage.ts';
import { sourceFile, testFile } from './graph.ts';
import { Listings, Narrowing } from './narrow.ts';
import { scopeOf } from './scope.ts';
import { budgetOf, coresOf, memoryOf } from '@runlith/testbed/budget';
import type { FileRow, Row } from '@runlith/testbed/ledger';
import type { FileVerdict, RunRow } from '@runlith/testbed/report';
import { runJobs } from '@runlith/testbed/schedule';

const started = performance.now();
const own = process.cpuUsage();
const TOOLKIT = resolve(import.meta.dir, '../..');
const scope = await scopeOf(process.argv.slice(2), {
  valued: [],
  switches: ['--plan', '--full'],
  usage:
    'bun run check:map [--base ref | --commit ref | --paths-from file] [--package path] [--file path] [--full] [--plan]\n' +
    'Maps, one process each, the Bun test files in scope whose coverage map is missing or stale: the candidates of the named change, or every file in scope when no change is named or --full is given.',
  session: false,
});
const { args, root, cache, graph, changed, global, tests } = scope;
const selection = scope.named === undefined || args.includes('--full') || global !== undefined ? undefined : graph.select(tests, changed);
graph.save();
const coverage = new Coverage(cache);
const narrowing = new Narrowing(graph, coverage);
const scoped = tests.filter((file) => selection === undefined || selection.selected.has(file));
const unmapped = scoped.filter((file) => graph.runner(file) !== 'bun');
const weight = (file: string): number => (file.includes('.itest.') ? 1e6 : 0) + graph.closure(file).inputs.length;
const wanted = scoped
  .filter((file) => graph.runner(file) === 'bun')
  .flatMap((file) => {
    const verdict = narrowing.judge(file, []);
    return verdict.keep ? [{ file, why: verdict.why, weight: weight(file) }] : [];
  })
  .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
  .map(({ file, why }) => ({ file, why }));
if (args.includes('--plan')) {
  console.log(
    JSON.stringify(
      { scope: scoped.length, current: scoped.length - unmapped.length - wanted.length, vitest: unmapped.length, wanted },
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(
  `check:map: ${wanted.length} of ${scoped.length} files to map; ${scoped.length - unmapped.length - wanted.length} maps current, ${unmapped.length} Vitest files have none`,
);
const runId = randomUUID();
const run = join(cache, runId);
mkdirSync(run);
const cli = join(existsSync(join(root, 'packages/testbed/src/cli.ts')) ? root : TOOLKIT, 'packages/testbed/src/cli.ts');
const preload = join(TOOLKIT, 'scripts/change/testing/spawned.ts');
const trace = join(TOOLKIT, 'scripts/change/testing/trace.ts');
const listings = new Listings(graph);
const statOf = (path: string): string | undefined => {
  const info = statSync(join(root, path), { throwIfNoEntry: false });
  return info === undefined ? undefined : `${info.mtimeMs}:${info.size}`;
};
const texts = new Map<string, { readonly stat: string; readonly stamp: string; readonly text: string }>();
const textOf = (path: string, stat: string): { readonly stamp: string; readonly text: string } | undefined => {
  const held = texts.get(path);
  if (held?.stat === stat) return held;
  const text = readFileSync(join(root, path), 'utf8');
  if (statOf(path) !== stat) return undefined;
  const fresh = { stat, stamp: createHash('sha256').update(text).digest('hex'), text };
  texts.set(path, fresh);
  return fresh;
};
const lines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
const real = realpathSync(root);
const scripts = [...graph.files].filter(sourceFile);
const bundles = new Map<string, readonly string[]>();
const sourcesOf = (module: string): readonly string[] => {
  let sources = bundles.get(module);
  if (sources === undefined) {
    const tail = module.replace(/^(?:\.\.\/)+/, '');
    sources = scripts.filter((path) => path === tail || path.endsWith(`/${tail}`));
    bundles.set(module, sources);
  }
  return sources;
};
const before = new Map<
  string,
  { readonly at: number; readonly closure: ReadonlySet<string>; readonly stats: ReadonlyMap<string, string | undefined> }
>();
const FLUSH = 100;
let batch = new Batch();
let mapped = 0;
let cpu = 0;
let failed = 0;
let unstable = 0;
let interrupted = 0;
const inherited = { ...process.env };
delete inherited['RUNLITH_CHANGE_SPAWNED_CHILD'];
const options = (process.env['BUN_OPTIONS'] ?? '')
  .split(' ')
  .filter((option) => option !== '' && option !== `--preload=${preload}`)
  .join(' ');
if (options === '') delete inherited['BUN_OPTIONS'];
else inherited['BUN_OPTIONS'] = options;
const jobs = wanted.map(({ file }, at) => {
  const pkg = graph.package(file);
  const cwd = join(root, pkg.dir);
  const dir = join(run, String(at));
  writeFileSync(
    `${dir}.audit.json`,
    JSON.stringify({
      root: real,
      report: `${dir}.audit.jsonl`,
      runner: 'bun',
      importers: [],
      entries: [{ file, packages: [], files: [] }],
    }),
  );
  return {
    id: String(at),
    cwd,
    stages: [
      [
        process.execPath,
        cli,
        process.execPath,
        'test',
        '--no-orphans',
        '--no-isolate',
        '--coverage',
        '--coverage-reporter=lcov',
        `--coverage-dir=${dir}`,
        `--preload=${preload}`,
        `--preload=${trace}`,
        `./${relative(cwd, join(root, file))}`,
      ],
    ],
    need: 1,
    env: {
      ...inherited,
      RUNLITH_CHANGE_AUDIT: `${dir}.audit.json`,
      RUNLITH_TEST_REPORT: `${dir}.jsonl`,
      RUNLITH_CHANGE_SPAWNED: `${dir}.spawned`,
      RUNLITH_CHANGE_SPAWNED_ROOT: real,
    },
  };
});
const byId = new Map(wanted.map(({ file }, at) => [String(at), file]));
const settle = (file: string, job: (typeof jobs)[number], exit: number, output: string): string => {
  const dir = join(run, job.id);
  const rows = lines(`${dir}.jsonl`).map((line) => JSON.parse(line) as Row | FileVerdict | RunRow);
  cpu += rows.filter((row): row is RunRow => row.type === 'run').reduce((total, row) => total + row.cpu, 0);
  const row = rows.find((one): one is FileRow => one.type === 'file');
  const verdict = rows.find((one): one is FileVerdict => one.type === 'file-verdict' && row !== undefined && one.run === row.run);
  const problem =
    row === undefined
      ? 'runner produced no report for the file'
      : row.residue !== 0
        ? 'the file left processes behind'
        : exit !== 0 || verdict?.outcome !== 'pass'
          ? `the file did not pass (${verdict?.outcome ?? `exit ${exit}`})`
          : undefined;
  if (problem !== undefined) {
    writeFileSync(`${dir}.log`, output);
    failed++;
    batch.add(file, null);
    return `${problem}; ${dir}.log`;
  }
  const start = before.get(job.id)!;
  const loaded = new Map<string, Loaded>();
  let moved: string | undefined;
  let current: string | undefined;
  let executed: number[] = [];
  const steady = (path: string): { readonly stamp: string; readonly text: string } | undefined => {
    const stat = statOf(path);
    const held = start.stats.has(path)
      ? start.stats.get(path) === stat
      : (statSync(join(root, path), { throwIfNoEntry: false })?.ctimeMs ?? Infinity) < start.at;
    return stat === undefined || !held ? undefined : textOf(path, stat);
  };
  const hold = (path: string, lines: (text: string) => string): string | undefined => {
    const text = steady(path);
    if (text === undefined) return `${path} changed during the run`;
    coverage.keep(text.stamp, text.text);
    loaded.set(path, { stamp: text.stamp, lines: lines(text.text) });
    return undefined;
  };
  const read = new Map<string, string>();
  for (const line of new Set(lines(`${dir}.audit.jsonl`))) {
    const row = JSON.parse(line) as { readonly type: string; readonly path?: string };
    const path = row.type !== 'input' || row.path === undefined ? '..' : relative(real, row.path);
    if (moved !== undefined || path === '' || path.startsWith('..') || path.includes('node_modules/') || read.has(path)) continue;
    if (!graph.files.has(path)) {
      const listing = listings.stamp(path);
      if (listing !== 'missing') read.set(path, listing);
      continue;
    }
    const text = steady(path);
    if (text === undefined) moved = `${path} changed during the run`;
    else read.set(path, text.stamp);
  }
  for (const line of lines(join(dir, 'lcov.info'))) {
    if (moved !== undefined) break;
    if (line.startsWith('SF:')) {
      const path = relative(root, resolve(job.cwd, line.slice(3)));
      current = path.startsWith('..') || path.includes('node_modules/') ? undefined : path;
      executed = [];
    } else if (line.startsWith('DA:') && current !== undefined) {
      const [at, count] = line.slice(3).split(',').map(Number) as [number, number];
      if (count > 0) executed.push(at);
    } else if (line === 'end_of_record' && current !== undefined) {
      const ran = rangesOf(executed);
      moved = hold(current, () => ran);
      current = undefined;
    }
  }
  for (const path of start.closure)
    if (moved === undefined && testFile(path) && !loaded.has(path)) moved = hold(path, (text) => `1-${text.split('\n').length}`);
  rmSync(dir, { recursive: true, force: true });
  if (moved !== undefined) {
    unstable++;
    return `not mapped: ${moved}`;
  }
  if (loaded.size === 0) {
    failed++;
    return 'not mapped: the run reported no coverage';
  }
  const mains = new Set<string>();
  const bundled = new Set<string>();
  const opaque = new Set<string>();
  for (const line of new Set(lines(`${dir}.spawned`))) {
    const child = JSON.parse(line) as { readonly main: string; readonly bundled: readonly string[] | null };
    const path = relative(real, child.main);
    const shown = path.startsWith('..') ? child.main : path;
    if (!path.startsWith('..') && !path.includes('node_modules/') && graph.files.has(path) && sourceFile(path)) mains.add(path);
    else if (child.bundled === null) opaque.add(shown);
    else
      for (const module of child.bundled.filter((one) => !one.includes('node_modules/'))) {
        const sources = sourcesOf(module);
        if (sources.length === 0) opaque.add(`${shown} (bundled ${module})`);
        for (const source of sources) bundled.add(source);
      }
  }
  mapped++;
  batch.add(file, {
    run: runId,
    at: start.at,
    closure: start.closure,
    loaded,
    mains: [...mains].sort(),
    bundled,
    opaque: [...opaque].sort(),
    read,
  });
  if (batch.size >= FLUSH) {
    coverage.record(batch);
    batch = new Batch();
  }
  const children = mains.size + opaque.size + (bundled.size === 0 ? 0 : 1);
  return `mapped ${loaded.size} loaded sources${children === 0 ? '' : `, child entries: ${mains.size} in the checkout, ${bundled.size} bundled sources, ${opaque.size} opaque`}`;
};
const release = coverage.lease();
await runJobs(jobs, {
  budget: budgetOf(coresOf(process.env['TESTBED_CORES']), memoryOf()),
  serial: false,
  started: (job) => {
    const closure = new Set(graph.closure(byId.get(job.id)!).inputs.filter(sourceFile));
    before.set(job.id, { at: Date.now(), closure, stats: new Map([...closure].map((path) => [path, statOf(path)])) });
  },
  ended: (job, ending) => {
    const file = byId.get(job.id)!;
    if (ending.interrupted) interrupted++;
    console.log(
      `check:map: ${file}: ${ending.interrupted ? 'interrupted; its map stays as it was' : settle(file, jobs[Number(job.id)]!, ending.exit, ending.stdout + ending.stderr)}`,
    );
  },
});
coverage.record(batch);
release();
const spent = process.cpuUsage(own);
cpu += (spent.user + spent.system) / 1000;
console.log(
  `check:map: ${mapped} mapped, ${failed} failed, ${unstable} unstable, ${interrupted} interrupted; wall ${((performance.now() - started) / 1000).toFixed(2)} s, cpu ${(cpu / 1000).toFixed(2)} s; ${run}`,
);
process.exitCode = failed + unstable + interrupted === 0 ? 0 : 1;
