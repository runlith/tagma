import { relative, resolve } from 'node:path';
import { CHILD_KINDS, type ByKind } from './core/children.ts';
import type { Cost, FileRow, Spawned, TestRow, WorldRow } from './core/ledger.ts';

export const ITEMS = ['load', 'world', 'tenant', 'body', 'guard'] as const;
export type ItemName = (typeof ITEMS)[number];

export const TARGET_CPU_PER_FILE_MS: readonly [number, number] = [40, 80];

type Case = { readonly name: string; readonly outcome: 'pass' | 'fail' | 'skip' };

export type RunFacts = {
  readonly root: string;
  readonly runner: 'bun' | 'vitest' | 'other';
  readonly command: readonly string[];
  readonly cwd: string;
  readonly repo: string;
  readonly seed: number | undefined;
  readonly wall: number;
  readonly cpu: number;
  readonly queued: number;
  readonly code: number;
};

const unescape = (text: string): string =>
  text.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const attribute = (attributes: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match === null ? undefined : unescape(match[1]!);
};

type SuiteResult = { readonly tests: number; readonly outcome: Case['outcome'] };
export type Junit = { readonly cases: Map<string, Case[]>; readonly files: Map<string, SuiteResult> };
type Suite = {
  readonly name: string | undefined;
  readonly file: string | undefined;
  readonly tests: number;
  observed: number;
  failed: boolean;
};

export const junitOf = (junit: string, cwd: string, repo: string): Junit => {
  const cases = new Map<string, Case[]>();
  const files = new Map<string, SuiteResult>();
  const suites: Suite[] = [];
  const close = (suite: Suite): void => {
    if (suite.file === undefined) return;
    const tests = (cases.get(suite.file) ?? []).filter((entry) => entry.outcome !== 'skip').length;
    files.set(suite.file, {
      tests,
      outcome: suite.failed || suite.observed !== suite.tests ? 'fail' : tests === 0 ? 'skip' : 'pass',
    });
  };
  for (const match of junit.matchAll(/<testsuite\b([^>]*?)(\/?)>|<\/testsuite>|<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    if (match[0] === '</testsuite>') {
      const suite = suites.pop();
      if (suite !== undefined) close(suite);
      continue;
    }
    if (match[3] === undefined) {
      const attributes = match[1]!;
      const file = attribute(attributes, 'file');
      const line = attribute(attributes, 'line');
      const tests = Number(attribute(attributes, 'tests') ?? NaN);
      const failures = Number(attribute(attributes, 'failures') ?? NaN);
      const errors = Number(attribute(attributes, 'errors') ?? 0);
      const suite: Suite = {
        name: line === undefined ? undefined : attribute(attributes, 'name'),
        file: file === undefined || line !== undefined ? undefined : relative(repo, resolve(cwd, file)),
        tests,
        observed: 0,
        failed: !Number.isSafeInteger(tests) || tests < 0 || failures !== 0 || errors !== 0,
      };
      if (match[2] === '/') close(suite);
      else suites.push(suite);
      continue;
    }
    const attributes = match[3];
    const body = match[4] ?? '';
    const file = attribute(attributes, 'file');
    const name = attribute(attributes, 'name');
    const failed = /<failure\b|<error\b/.test(body);
    if (failed) for (const suite of suites) suite.failed = true;
    if (file === undefined) continue;
    const key = relative(repo, resolve(cwd, file));
    for (const suite of suites) if (suite.file === key) suite.observed++;
    if (name === undefined || attribute(attributes, 'line') === undefined) continue;
    const outcome = /<skipped\b|<todo\b/.test(body) ? 'skip' : failed ? 'fail' : 'pass';
    const path = suites.map((suite) => suite.name).filter((name) => name !== undefined && name !== '');
    cases.set(key, [...(cases.get(key) ?? []), { name: [...path, name].join(' > '), outcome }]);
  }
  return { cases, files };
};

export type FileVerdict = {
  readonly type: 'file-verdict';
  readonly run: string;
  readonly file: string;
  readonly outcome: Case['outcome'];
};

export const verdictsOf = (files: readonly FileRow[], junit: Junit): FileVerdict[] =>
  files.flatMap((file) => {
    const result = junit.files.get(file.file);
    return result === undefined
      ? []
      : [
          {
            type: 'file-verdict' as const,
            run: file.run,
            file: file.file,
            outcome: file.residue !== 0 || result.tests !== file.tests ? 'fail' : result.outcome,
          },
        ];
  });

export type OutcomeRow = {
  readonly type: 'outcome';
  readonly run: string;
  readonly worker: number;
  readonly file: string;
  readonly test: number;
  readonly name: string;
  readonly outcome: Case['outcome'];
};

export const outcomesOf = (
  tests: readonly TestRow[],
  cases: Map<string, Case[]>,
): { readonly rows: OutcomeRow[]; readonly unmatched: number } => {
  const byFile = new Map<string, TestRow[]>();
  for (const row of tests) byFile.set(row.file, [...(byFile.get(row.file) ?? []), row]);
  let unmatched = 0;
  const rows: OutcomeRow[] = [];
  for (const [file, list] of byFile) {
    const ran = (cases.get(file) ?? []).filter((entry) => entry.outcome !== 'skip');
    const ordered = [...list].sort((left, right) => left.test - right.test);
    if (ran.length !== ordered.length) {
      unmatched += ordered.length;
      continue;
    }
    ordered.forEach((row, index) =>
      rows.push({
        type: 'outcome',
        run: row.run,
        worker: row.worker,
        file,
        test: row.test,
        name: ran[index]!.name,
        outcome: ran[index]!.outcome,
      }),
    );
  }
  return { rows, unmatched };
};

export type OwnWorld = { readonly file: string; readonly kind: string; readonly own: string };

export type WorldSummary = {
  readonly built: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly cost: Cost;
  readonly files: number;
  readonly ready: number;
  readonly rebuilt: readonly string[];
  readonly own: readonly OwnWorld[];
};

export const worldsOf = (rows: readonly WorldRow[]): WorldSummary => {
  const shared = rows.filter((row) => row.own === null);
  const builds = new Map<string, number>();
  for (const row of shared) if (row.built) builds.set(`${row.worker}\0${row.key}`, (builds.get(`${row.worker}\0${row.key}`) ?? 0) + 1);
  const byKind: Record<string, number> = {};
  for (const row of shared) if (row.built) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  const files = new Set(shared.map((row) => row.file));
  const building = new Set(shared.filter((row) => row.built).map((row) => row.file));
  return {
    built: shared.filter((row) => row.built).length,
    byKind,
    cost: sum(shared.map((row) => row.cost)),
    files: files.size,
    ready: [...files].filter((file) => !building.has(file)).length,
    rebuilt: [...builds].flatMap(([key, count]) => (count > 1 ? [key.split('\0')[1]!] : [])),
    own: rows.filter((row) => row.own !== null).map((row) => ({ file: row.file, kind: row.kind, own: row.own! })),
  };
};

const sum = (costs: readonly Cost[]): Cost =>
  costs.reduce((into, cost) => ({ cpu: into.cpu + cost.cpu, wall: into.wall + cost.wall }), { cpu: 0, wall: 0 });

const childCost = (file: FileRow): number => CHILD_KINDS.reduce((total, kind) => total + file.children[kind].cpu, 0);

export const workersOf = (files: readonly FileRow[]) => {
  const byWorker = new Map<number, FileRow[]>();
  for (const file of files) byWorker.set(file.worker, [...(byWorker.get(file.worker) ?? []), file]);
  return [...byWorker].map(([worker, list]) => {
    const ordered = [...list].sort((left, right) => left.seq - right.seq);
    return { type: 'worker' as const, worker, files: ordered.map((file) => file.file), total: sum(ordered.map((file) => file.total)) };
  });
};

export type RunRow = {
  readonly type: 'run';
  readonly run: string;
  readonly runner: RunFacts['runner'];
  readonly command: string;
  readonly cwd: string;
  readonly seed: number | undefined;
  readonly code: number;
  readonly wall: number;
  readonly cpu: number;
  readonly queued: number;
  readonly files: number;
  readonly tests: number;
  readonly cpuPerFile: number;
  readonly target: { readonly cpuPerFile: readonly [number, number] };
  readonly items: Readonly<Record<ItemName, Cost>>;
  readonly children: ByKind<Spawned>;
  readonly worlds: WorldSummary;
};

export const runOf = (facts: RunFacts, files: readonly FileRow[], tests: number, worlds: WorldSummary): RunRow => {
  const items = Object.fromEntries(ITEMS.map((item) => [item, sum(files.map((file) => file[item]))])) as Record<ItemName, Cost>;
  const children = Object.fromEntries(
    CHILD_KINDS.map((kind) => [
      kind,
      {
        count: files.reduce((total, file) => total + file.children[kind].count, 0),
        cpu: files.reduce((total, file) => total + file.children[kind].cpu, 0),
        unmeasured: files.reduce((total, file) => total + file.children[kind].unmeasured, 0),
      },
    ]),
  ) as ByKind<Spawned>;
  return {
    type: 'run' as const,
    run: facts.root,
    runner: facts.runner,
    command: facts.command.join(' '),
    cwd: relative(facts.repo, facts.cwd) || '.',
    seed: facts.seed,
    code: facts.code,
    wall: Math.round(facts.wall),
    cpu: Math.round(facts.cpu),
    queued: Math.round(facts.queued),
    files: files.length,
    tests,
    cpuPerFile: files.length === 0 ? 0 : Math.round(facts.cpu / files.length),
    target: { cpuPerFile: TARGET_CPU_PER_FILE_MS },
    items,
    children,
    worlds,
  };
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export const summary = (run: RunRow, files: readonly FileRow[], unmatched: number, report: string): string => {
  const { worlds } = run;
  const lines = [
    `testbed: ${run.files} files, ${run.tests} tests, wall ${seconds(run.wall)}, cpu ${seconds(run.cpu)} (${run.cpuPerFile} ms per file; target ${TARGET_CPU_PER_FILE_MS.join('–')} ms)`,
    `  items cpu: ${ITEMS.map((item) => `${item} ${seconds(run.items[item].cpu)}`).join(', ')}`,
    `  children within those items: ${CHILD_KINDS.map((kind) => `${kind} ${run.children[kind].count} (${seconds(run.children[kind].cpu)})`).join(', ')}`,
  ];
  if (worlds.files > 0) {
    const kinds = Object.entries(worlds.byKind)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(', ');
    lines.push(
      `  worlds: ${worlds.built} built (${kinds}; cpu ${seconds(worlds.cost.cpu)}), ${worlds.ready} of ${worlds.files} files took a ready world`,
    );
  }
  for (const key of worlds.rebuilt) lines.push(`  world built more than once in one worker: ${key}`);
  if (worlds.own.length > 0) {
    lines.push(`  own worlds by declaration: ${worlds.own.length} in ${new Set(worlds.own.map((row) => row.file)).size} files`);
    for (const row of worlds.own) lines.push(`    ${row.file}: ${row.kind} (${row.own})`);
  }
  const unmeasured = CHILD_KINDS.reduce((total, kind) => total + run.children[kind].unmeasured, 0);
  if (unmeasured > 0) lines.push(`  ${unmeasured} children ran without a CPU reading on this runtime; their CPU is missing from the items`);
  const costly = [...files].sort((left, right) => right.total.cpu - left.total.cpu).slice(0, 5);
  if (costly.length > 0) lines.push('  costliest files by cpu:');
  for (const file of costly) {
    const parts = ITEMS.map((item) => `${item} ${seconds(file[item].cpu)}`).join(', ');
    lines.push(`    ${seconds(file.total.cpu)} ${file.file} (${parts}; children ${seconds(childCost(file))} of it)`);
  }
  if (unmatched > 0) lines.push(`  ${unmatched} test rows kept no name: the junit report and the run disagreed on their files`);
  lines.push(`  report: ${report}`);
  return lines.join('\n');
};
