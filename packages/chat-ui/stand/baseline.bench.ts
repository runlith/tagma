import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { session } from '@runlith/e2e/engines';
import { serveStand } from '@runlith/e2e/stand';
import { artifactDirectory } from '@runlith/e2e/artifacts';
import { Data, Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, loadavg, release } from 'node:os';
import { evidence, type Evidence } from './evidence';
import { controlSource, ready, runScenario, ScenarioFailure, type MotionSource } from './scenarios';
import { chromiumOnly, scenarioNames } from './scenario';
import { controls, heldControls } from './controls';
import { displacement, type ControlEnvelope, type DisplacementEvidence } from './displacement';
import { checkHistorical } from './historical.fixture';

class BaselineFailed extends Data.TaggedError('BaselineFailed')<{ readonly message: string; readonly cause: unknown }> {}
const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new BaselineFailed({ message, cause }) });
type Result = {
  lane: string;
  scenario: string;
  refusal: string | null;
  evidence: Evidence | null;
  movement: DisplacementEvidence | null;
  artifacts: string;
};
type Calibration = { source: MotionSource; artifacts: string; envelope: ControlEnvelope | null; refusal: string | null };

const measure = Effect.fnUntraced(function* (url: string, lane: 'chromium' | 'webkit') {
  const files = yield* FileSystem.FileSystem;
  const fixture = yield* session(
    lane,
    { viewport: { width: 1280, height: 900 }, hasTouch: true },
    { own: 'detached branch-base measurement' },
  );
  if (fixture.cdp !== undefined)
    yield* attempted('CPU throttling failed', () => fixture.cdp!.send('Emulation.setCPUThrottlingRate', { rate: 4 }));
  const envelopes = new Map<MotionSource, ControlEnvelope | null>();
  const calibrations: Calibration[] = [];
  const results: Result[] = [];
  const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  for (const name of scenarioNames) {
    if (lane === 'webkit' && chromiumOnly.includes(name)) continue;
    const source = controlSource(name, fixture.cdp);
    if (source !== undefined && !envelopes.has(source)) {
      const measured = yield* Effect.result(
        attempted(`${lane}:${source}: control flings failed`, () => controls(fixture.page, fixture, url, source)),
      );
      const artifacts = artifactDirectory(Bun.main, `${lane}-${source}-controls`);
      if (measured._tag === 'Failure') {
        envelopes.set(source, null);
        calibrations.push({ source, artifacts, envelope: null, refusal: reason(measured.failure.cause) });
        console.log(JSON.stringify({ lane, source, refusal: reason(measured.failure.cause) }));
      } else {
        envelopes.set(source, measured.success.envelope);
        yield* files.writeFileString(join(artifacts, 'controls.json'), JSON.stringify(measured.success));
        calibrations.push({ source, artifacts, envelope: measured.success.envelope, refusal: null });
        console.log(
          JSON.stringify({
            lane,
            source,
            controls: measured.success.envelope.controls,
            discarded: measured.success.envelope.discarded,
            artifacts,
          }),
        );
      }
    }
    const envelope = (source === undefined ? undefined : envelopes.get(source)) ?? undefined;
    const artifacts = artifactDirectory(Bun.main, `${lane}-${name}`);
    const outcome = yield* Effect.result(
      Effect.tryPromise({
        try: async () => {
          const held = name === 'drag-page-landing' ? await heldControls(fixture.page, url, fixture.touch) : undefined;
          await fixture.page.goto(url);
          await ready(fixture.page);
          return await runScenario(fixture.page, fixture, name, { jump: 'jumpToLatest', held });
        },
        catch: (cause) => cause,
      }),
    );
    const recording =
      outcome._tag === 'Success' ? outcome.success : outcome.failure instanceof ScenarioFailure ? outcome.failure.recording : null;
    const refusal = outcome._tag === 'Failure' ? reason(outcome.failure) : null;
    if (recording === null) {
      results.push({ lane, scenario: name, refusal, evidence: null, movement: null, artifacts });
      console.log(JSON.stringify({ lane, scenario: name, refusal }));
      continue;
    }
    const result = evidence(recording);
    const movement = displacement(recording, envelope);
    yield* files.writeFileString(join(artifacts, 'frames.json'), JSON.stringify(recording));
    results.push({ lane, scenario: name, refusal, evidence: result, movement, artifacts });
    console.log(
      JSON.stringify({
        lane,
        scenario: name,
        refusal,
        evidence: result,
        movement: {
          maxError: movement.maxError,
          failures: movement.failures.length,
          unchecked: movement.unchecked.length,
          lateWheels: movement.lateWheels.length,
        },
        artifacts,
      }),
    );
  }
  return { browser: fixture.browser.version(), results, calibrations };
});

const program = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  yield* checkHistorical(process.env.FEED_STAND_SOURCE);
  const served = yield* serveStand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)), {
    own: 'detached branch-base measurement',
  });
  const lanes = (process.env.BASELINE_LANES ?? 'chromium,webkit').split(',');
  const chromium = lanes.includes('chromium') ? yield* Effect.scoped(measure(served.url(), 'chromium')) : null;
  const webkit = lanes.includes('webkit') ? yield* Effect.scoped(measure(served.url(), 'webkit')) : null;
  const report = {
    source: process.env.FEED_STAND_SOURCE,
    revision: process.env.FEED_STAND_REVISION,
    fixtureDifference: "Only chatHarness.svelte.ts TestClock's testing barrel import is rewritten to its direct module for browser safety.",
    machine: { cpu: cpus()[0]?.model, cores: cpus().length, os: release(), load: loadavg() },
    chromium,
    webkit,
  };
  const output = process.argv[2];
  if (output !== undefined) yield* files.writeFileString(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      output,
      browsers: { chromium: chromium?.browser ?? null, webkit: webkit?.browser ?? null },
      scenarios: (chromium?.results.length ?? 0) + (webkit?.results.length ?? 0),
    }),
  );
});
await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(BunFileSystem.layer)));
