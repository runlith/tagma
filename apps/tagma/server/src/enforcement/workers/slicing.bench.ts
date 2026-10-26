import { type Assembled, BUILTINS } from '@tagma/inspection/builtins';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import type { WorkerAsk } from './asks.js';
import { InspectionFailed, pool } from './inspectionLanes.js';
import { type Answered, slicedJudge, slicedReading } from './slicing.js';

type Declared = {
  readonly fields: { readonly enforcement: { readonly checks: readonly { readonly builtin: string; readonly params: unknown }[] } };
};
type Row = { readonly kind: string; readonly packages: number; readonly ms: number; readonly needs: number; readonly walked: number };

const root = resolve(import.meta.dir, '../../../../..');
const git = (args: readonly string[]): string =>
  Bun.spawnSync(['git', ...args], { cwd: root })
    .stdout.toString()
    .trim();
const commit = git(['rev-parse', process.argv[2] ?? 'HEAD']);
const [, frontmatter] = git(['show', `${commit}:.tagma/runlith/start-doors.md`]).split(/^---$/m);
const check = (Bun.YAML.parse(frontmatter ?? '') as Declared).fields.enforcement.checks.find(({ builtin }) => builtin === 'platforms');
if (check === undefined) throw new Error(`${commit} declares no platforms check on rule 50520d64`);
const inspection = { builtin: 'platforms', params: Schema.decodeUnknownSync(BUILTINS.platforms.params)(check.params) } as Assembled;
const cacheRoot = mkdtempSync(join(tmpdir(), 'tagma-slicing-bench-'));
const workerOf = (name: string) => pool(new URL('./judge.worker.ts', import.meta.url), [name], { cacheRoot });
let worker = workerOf('bench worker 1');
const failing = (cause: InspectionFailed['cause'], reason: string) => new InspectionFailed({ cause, reason });

const kindOf = (ask: WorkerAsk, reply: Answered): string => ('reading' in reply ? 'known' : 'same' in reply ? 'same' : ask.kind);

const measured = async <A>(
  label: string,
  work: (answer: (ask: WorkerAsk) => Effect.Effect<Answered, InspectionFailed>) => Effect.Effect<A, InspectionFailed>,
) => {
  const rows: Row[] = [];
  const answer = (ask: WorkerAsk) =>
    worker.answer(ask).pipe(
      Effect.tap((reply) =>
        Effect.sync(() => {
          rows.push({
            kind: kindOf(ask, reply),
            packages: ask.kind === 'slice' && ask.scope.parts !== 'whole' ? ask.scope.parts.length : 0,
            ms: reply.ms,
            needs: 'sliced' in reply ? reply.sliced.needs.length : 0,
            walked: 'sliced' in reply ? (reply.sliced.stats?.walked ?? 0) : 0,
          });
        }),
      ),
    );
  const started = performance.now();
  const result = await Effect.runPromise(work(answer));
  const slices = rows.filter(({ kind }) => kind === 'slice');
  console.log(
    `${label}: ${rows.length} worker asks in ${(performance.now() - started).toFixed(0)} ms wall, slowest slice ask ${slices.length === 0 ? 0 : Math.max(...slices.map(({ ms }) => ms))} ms, ${slices.reduce((sum, row) => sum + row.walked, 0)} starts re-walked`,
  );
  for (const row of rows)
    console.log(
      `  ${row.kind.padEnd(5)} ${String(row.ms).padStart(6)} ms${row.kind === 'slice' ? `  ${row.packages} packages, ${row.needs} frontier needs, ${row.walked} re-walked` : ''}`,
    );
  return result;
};

const reading = (label: string, at = commit, job = label) =>
  measured(label, (answer) => slicedReading(answer, { root, commit: at, inspection, places: [''], job }, failing)).then(({ reading }) => {
    console.log(`  ${reading.violations.length} violations`);
    return reading;
  });

const landing = (label: string, base: string, built: string, paths: readonly string[]) =>
  measured(label, (answer) =>
    slicedJudge(answer, { lane: 'landing', root, base, built, paths, places: [''], inspection, debt: [] }, failing),
  ).then(({ verdict }) => {
    console.log(`  verdict: ${verdict.violations.length} violations, ${verdict.unjudged.length} unjudged`);
    return verdict;
  });

const planned = await Effect.runPromise(worker.answer({ kind: 'plan', root, commit, inspection, places: [''], job: 'plan' }));
if ('plan' in planned) {
  console.log(
    `${commit}: ${planned.plan.slices.length} slices under ${planned.plan.envelope.files} files and ${planned.plan.envelope.mib} MiB per ask`,
  );
  for (const slice of planned.plan.slices)
    console.log(`  ${slice.parts.length} packages, ${slice.files} source files, ${(slice.bytes / 1024 / 1024).toFixed(1)} MiB`);
}
const cold = await reading('cold store, fresh worker');
const warm = await reading('warm store, new job');
console.log(
  `cold and warm verdicts agree: ${JSON.stringify(cold) === JSON.stringify(warm)}. One machine sample; the lowest class is not measured here.`,
);
if (process.argv[3] !== undefined) {
  const built = git(['rev-parse', process.argv[3]]);
  const base = git(['rev-parse', `${built}^`]);
  const changed = git(['diff', '--name-only', base, built]).split('\n').filter(Boolean);
  if (changed.length !== 1) throw new Error(`The benchmark needs one changed path, found ${changed.length}`);
  console.log(`one-file change: ${base.slice(0, 10)}..${built.slice(0, 10)} ${changed[0]}`);
  await landing('the base judged against itself, warm worker', base, base, changed);
  worker.close();
  worker = workerOf('bench worker 2');
  await landing('one-file landing over a judged base, fresh worker', base, built, changed);
  worker.close();
  worker = workerOf('bench worker 3');
  await landing('the next landing on the judged tree, fresh worker', built, built, changed);
}
worker.close();
rmSync(cacheRoot, { recursive: true, force: true });
