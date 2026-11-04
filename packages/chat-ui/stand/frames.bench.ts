import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { session } from '@runlith/e2e/engines';
import { serveStand } from '@runlith/e2e/stand';
import { arch, availableParallelism, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Clock, Data, Effect, FileSystem, Schema } from 'effect';
import type { Page } from 'playwright-core';
import type { StandGlobal } from './port';
import { runScenario } from './scenarios';
import { scenarioNames } from './scenario';
import { account, capture, distribution, Distribution, FrameWork, WorkSummary } from './trace';
import { prepareThumb } from './thumb';
import { checkHistorical } from './historical.fixture';
import { heldControls, prepareControls, recordControl, type ControlRegion } from './controls';
import type { ScenarioName } from './scenario';

type MeasuringCase = { kind: 'scenario'; name: ScenarioName } | { kind: 'control'; name: string };

const VIEWPORT = { width: 1280, height: 900 };
const CPU_RATE = 4;
const REFERENCE = 16.7;
const METHOD = [
  'Production stand build; Chromium headless with 4x CDP CPU throttling and a fresh page navigation per scenario.',
  'Refresh is the median of 60 idle requestAnimationFrame intervals before each scenario; headless cadence does not establish physical-panel refresh.',
  'Frames are consecutive timing-only recorder rAF timestamp intervals. The first and last partial intervals are excluded.',
  'Open-tail remounts fresh surface state over the page’s warm shared markdown cache; cold page/network startup is outside capture.',
  'Native-thumb reference preparation runs per fresh thumb scenario before timing mode and tracing, outside the measured intervals.',
  'Held-touch calibration for drag-page-landing (pan prelude and known-distance control on a warmed 10000-entry page) runs before its scenario navigation, outside the measured intervals.',
  'A unique performance.mark aligns the page clock with its renderer main-thread trace clock.',
  'Synchronous trace spans are partitioned into disjoint intervals: the innermost classified span wins; unclassified task time is other.',
  'Script includes JavaScript execution, callbacks, microtasks and V8 GC; layout includes style recalculation; paint includes main-thread compositing preparation.',
  'Total is the union of main-thread task and classified spans, not their inclusive-duration sum. All non-main-thread work, including highlighting workers, raster/compositor threads and GPU work, is excluded.',
  'Timing-only recording disables DOM geometry, anchor and sentinel sampling. Minimal rAF timestamp bookkeeping and scenario-driver overhead remain; trace-clock synchronization precedes the recorded intervals.',
  'Counts over the measured cadence and 16.7ms reference at 4x throttling are observations, never pass/fail.',
  'Run alone in a quiet window. Compare adjacent alternating baseline/current runs at similar load; a cross-machine or unlike-load ratio proves no code cost.',
];

const Machine = Schema.Struct({
  cpu: Schema.String,
  cores: Schema.Number,
  parallelism: Schema.Number,
  memoryBytes: Schema.Number,
  platform: Schema.String,
  release: Schema.String,
  arch: Schema.String,
});

const Load = Schema.Struct({
  time: Schema.Number,
  averages: Schema.Array(Schema.Number),
  freeMemoryBytes: Schema.Number,
  cpuIdle: Schema.Number,
  cpuTotal: Schema.Number,
});
type Load = typeof Load.Type;

const ScenarioResult = Schema.Struct({
  name: Schema.String,
  refreshMs: Schema.Number,
  refreshHz: Schema.Number,
  idleIntervals: Distribution,
  loadBefore: Load,
  loadAfter: Load,
  machineBusyShare: Schema.NullOr(Schema.Number),
  thread: Schema.Struct({ pid: Schema.Number, tid: Schema.Number }),
  summary: WorkSummary,
  frames: Schema.Array(FrameWork),
});
type ScenarioResult = typeof ScenarioResult.Type;

const Report = Schema.Struct({
  schema: Schema.Literal('feed-frame-work/v1'),
  source: Schema.Struct({ root: Schema.String, revision: Schema.NullOr(Schema.String) }),
  startedAt: Schema.Number,
  endedAt: Schema.Number,
  machine: Machine,
  browser: Schema.String,
  viewport: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  cpuRate: Schema.Number,
  referenceMs: Schema.Number,
  method: Schema.Array(Schema.String),
  loadBefore: Load,
  loadAfter: Load,
  machineBusyShare: Schema.NullOr(Schema.Number),
  scenarios: Schema.Array(ScenarioResult),
});
type Report = typeof Report.Type;

type Delta = { baseline: number; current: number; delta: number; ratio: number | null };
type Quantiles = { p50: Delta; p95: Delta; p99: Delta; max: Delta };
type ScenarioComparison = {
  name: string;
  baselineFrames: number;
  currentFrames: number;
  baselineRefreshMs: number;
  currentRefreshMs: number;
  work: { script: Quantiles; layout: Quantiles; paint: Quantiles; other: Quantiles; total: Quantiles };
};
type Comparison = {
  path: string;
  conditions: {
    baselineSource: Report['source'];
    currentSource: Report['source'];
    baselineMachine: Report['machine'];
    currentMachine: Report['machine'];
    baselineBrowser: string;
    currentBrowser: string;
    baselineMethod: Report['method'];
    currentMethod: Report['method'];
    baselineViewport: Report['viewport'];
    currentViewport: Report['viewport'];
    baselineCpuRate: number;
    currentCpuRate: number;
    baselineLoadBefore: Load;
    baselineLoadAfter: Load;
    currentLoadBefore: Load;
    currentLoadAfter: Load;
  };
  missingBaseline: string[];
  missingCurrent: string[];
  scenarios: ScenarioComparison[];
};

class MeasurementFailed extends Data.TaggedError('MeasurementFailed')<{ message: string; cause?: unknown }> {}

const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new MeasurementFailed({ message, cause }) });

const snapshotLoad = Effect.fn('stand.load')(function* () {
  const time = yield* Clock.currentTimeMillis;
  const processors = cpus();
  let cpuIdle = 0;
  let cpuTotal = 0;
  for (const processor of processors) {
    cpuIdle += processor.times.idle;
    cpuTotal += Object.values(processor.times).reduce((sum, value) => sum + value, 0);
  }
  return { time, averages: loadavg(), freeMemoryBytes: freemem(), cpuIdle, cpuTotal };
});

function busyShare(before: Load, after: Load): number | null {
  const total = after.cpuTotal - before.cpuTotal;
  return total <= 0 ? null : 1 - (after.cpuIdle - before.cpuIdle) / total;
}

async function measureCadence(page: Page): Promise<Distribution> {
  const times = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = (time: number) => {
          samples.push(time);
          if (samples.length === 61) resolve(samples);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  return distribution(times.slice(1).map((time, index) => time - times[index]!));
}

function delta(baseline: number, current: number): Delta {
  return { baseline, current, delta: current - baseline, ratio: baseline === 0 ? null : current / baseline };
}

function quantiles(baseline: Distribution, current: Distribution): Quantiles {
  return {
    p50: delta(baseline.p50, current.p50),
    p95: delta(baseline.p95, current.p95),
    p99: delta(baseline.p99, current.p99),
    max: delta(baseline.max, current.max),
  };
}

function compare(path: string, baseline: Report, current: Report): Comparison {
  const previous = new Map(baseline.scenarios.map((scenario) => [scenario.name, scenario]));
  const names = new Set(current.scenarios.map((scenario) => scenario.name));
  const scenarios: ScenarioComparison[] = [];
  const missingBaseline: string[] = [];
  for (const scenario of current.scenarios) {
    const before = previous.get(scenario.name);
    if (before === undefined) {
      missingBaseline.push(scenario.name);
      continue;
    }
    scenarios.push({
      name: scenario.name,
      baselineFrames: before.frames.length,
      currentFrames: scenario.frames.length,
      baselineRefreshMs: before.refreshMs,
      currentRefreshMs: scenario.refreshMs,
      work: {
        script: quantiles(before.summary.script, scenario.summary.script),
        layout: quantiles(before.summary.layout, scenario.summary.layout),
        paint: quantiles(before.summary.paint, scenario.summary.paint),
        other: quantiles(before.summary.other, scenario.summary.other),
        total: quantiles(before.summary.total, scenario.summary.total),
      },
    });
  }
  return {
    path,
    conditions: {
      baselineSource: baseline.source,
      currentSource: current.source,
      baselineMachine: baseline.machine,
      currentMachine: current.machine,
      baselineBrowser: baseline.browser,
      currentBrowser: current.browser,
      baselineMethod: baseline.method,
      currentMethod: current.method,
      baselineViewport: baseline.viewport,
      currentViewport: current.viewport,
      baselineCpuRate: baseline.cpuRate,
      currentCpuRate: current.cpuRate,
      baselineLoadBefore: baseline.loadBefore,
      baselineLoadAfter: baseline.loadAfter,
      currentLoadBefore: current.loadBefore,
      currentLoadAfter: current.loadAfter,
    },
    missingBaseline,
    missingCurrent: baseline.scenarios.filter((scenario) => !names.has(scenario.name)).map((scenario) => scenario.name),
    scenarios,
  };
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    baseline: { type: 'string' },
    output: { type: 'string' },
    controls: { type: 'boolean' },
    scenario: { type: 'string', multiple: true },
    count: { type: 'string' },
    traces: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
  allowPositionals: false,
});

const program = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const baseline =
    values.baseline === undefined
      ? undefined
      : yield* files
          .readFileString(resolve(values.baseline))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Report))));
  yield* checkHistorical(process.env.FEED_STAND_SOURCE);
  const served = yield* serveStand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)), { own: 'quiet-window measuring command' });
  const { page, browser, cdp, touch } = yield* session(
    'chromium',
    { viewport: VIEWPORT, hasTouch: true },
    { own: 'quiet-window measuring command' },
  );
  if (cdp === undefined)
    return yield* new MeasurementFailed({ message: 'Chromium did not expose the CDP session required for trace measuring' });
  yield* attempted('Chromium CPU throttling failed', () => cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE }));
  const processors = cpus();
  const machine = {
    cpu: processors[0]?.model ?? 'unknown',
    cores: processors.length,
    parallelism: availableParallelism(),
    memoryBytes: totalmem(),
    platform: platform(),
    release: release(),
    arch: arch(),
  };
  const startedAt = yield* Clock.currentTimeMillis;
  const loadBefore = yield* snapshotLoad();
  const scenarios: ScenarioResult[] = [];
  const count = Number(values.count ?? 5);
  if (!Number.isInteger(count) || count < 1) return yield* new MeasurementFailed({ message: '--count must be a positive integer' });
  const unknown = (values.scenario ?? []).filter((name) => !scenarioNames.includes(name as ScenarioName));
  if (unknown.length > 0) return yield* new MeasurementFailed({ message: `Unknown --scenario ${unknown.join(', ')}` });
  const selected: MeasuringCase[] =
    values.controls === true
      ? Array.from({ length: count }, (_, index) => ({ kind: 'control', name: `control-${index + 1}` }))
      : scenarioNames
          .filter((name) => values.scenario === undefined || values.scenario.includes(name))
          .map((name) => ({ kind: 'scenario', name }));
  let region: ControlRegion | undefined;
  if (values.traces !== undefined) yield* files.makeDirectory(resolve(values.traces), { recursive: true });
  for (const item of selected) {
    const name = item.name;
    const held =
      item.kind === 'scenario' && name === 'drag-page-landing'
        ? yield* attempted(`${name}: held touch calibration failed`, () => heldControls(page, served.url(), touch))
        : undefined;
    if (item.kind === 'scenario' || region === undefined) {
      yield* attempted(`${name}: the stand did not become ready`, async () => {
        await page.goto(item.kind === 'control' ? new URL('?loaded=10000', served.url()).href : served.url());
        await page.waitForFunction(() => (window as StandGlobal).feedStand?.ready === true);
      });
    }
    if (item.kind === 'control' && region === undefined)
      region = yield* attempted('Control-region warmup failed', () => prepareControls(page));
    const prepared = region;
    const thumb =
      item.kind === 'scenario' && name === 'thumb-history'
        ? yield* attempted(`${name}: native-thumb reference preparation failed`, () => prepareThumb(page))
        : undefined;
    yield* attempted(`${name}: timing-only recording is unavailable`, () =>
      page.evaluate(() => {
        const stand = (window as StandGlobal).feedStand;
        if (stand?.timing === undefined) throw new Error('the stand does not expose timing-only recording');
        stand.timing();
      }),
    );
    const idleIntervals = yield* attempted(`${name}: refresh calibration failed`, () => measureCadence(page));
    const before = yield* snapshotLoad();
    const traced = yield* attempted(`${name}: tracing the scenario failed`, () =>
      capture(cdp, page, () =>
        item.kind === 'control'
          ? recordControl(page, { cdp, touch }, prepared!, name)
          : runScenario(page, { cdp, touch }, item.name, { jump: 'jumpToLatest', thumb, held }),
      ),
    );
    if (values.traces !== undefined)
      yield* files.writeFileString(
        join(resolve(values.traces), `${name}.json`),
        JSON.stringify({ traceEvents: traced.events, marker: traced.marker, markerTime: traced.markerTime, recording: traced.result }),
      );
    const after = yield* snapshotLoad();
    const timings = traced.result.timings;
    if (timings === undefined) return yield* new MeasurementFailed({ message: `${name}: the scenario returned no timing-only timestamps` });
    const accounted = yield* Effect.try({
      try: () => account(traced, timings, idleIntervals.p50, REFERENCE),
      catch: (cause) => new MeasurementFailed({ message: `${name}: trace accounting failed`, cause }),
    });
    scenarios.push({
      name,
      refreshMs: idleIntervals.p50,
      refreshHz: 1000 / idleIntervals.p50,
      idleIntervals,
      loadBefore: before,
      loadAfter: after,
      machineBusyShare: busyShare(before, after),
      ...accounted,
    });
  }
  const loadAfter = yield* snapshotLoad();
  const endedAt = yield* Clock.currentTimeMillis;
  const report: Report = {
    schema: 'feed-frame-work/v1',
    source: {
      root: resolve(process.env.FEED_STAND_SOURCE ?? fileURLToPath(new URL('../src', import.meta.url))),
      revision: process.env.FEED_STAND_REVISION ?? null,
    },
    startedAt,
    endedAt,
    machine,
    browser: browser.version(),
    viewport: VIEWPORT,
    cpuRate: CPU_RATE,
    referenceMs: REFERENCE,
    method:
      values.controls === true
        ? [
            ...METHOD,
            'Control attribution: identical 5000px touch flings on one fully loaded page; the same 12000px region is warmed before timing mode, then each trial repositions to its measured start. No geometry recorder runs during capture.',
          ]
        : METHOD,
    loadBefore,
    loadAfter,
    machineBusyShare: busyShare(loadBefore, loadAfter),
    scenarios,
  };
  const comparison = baseline === undefined ? undefined : compare(resolve(values.baseline!), baseline, report);
  const artifact = { ...report, comparison };
  if (values.output !== undefined) {
    const output = resolve(values.output);
    yield* files.makeDirectory(dirname(output), { recursive: true });
    yield* files.writeFileString(output, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  const summary = {
    ...report,
    scenarios: report.scenarios.map(({ frames, ...scenario }) => ({ ...scenario, frameCount: frames.length })),
    comparison,
    output: values.output === undefined ? undefined : resolve(values.output),
  };
  yield* Effect.sync(() => console.log(JSON.stringify(summary, null, 2)));
});

if (values.help === true) {
  console.log(
    'testbed e2e --program stand/frames.bench.ts [--baseline <recorded.json>] [--output <measurement.json>] [--controls] [--scenario <name>]... [--traces <directory>]',
  );
  console.log(
    'Run alone after other tests finish. --output keeps per-frame work for a later --baseline comparison; budgets do not set the exit code.',
  );
  console.log('FEED_STAND_SOURCE selects the source tree; FEED_STAND_REVISION labels that tree in the report.');
} else {
  await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)));
}
