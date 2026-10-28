import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { session } from '@runlith/e2e/engines';
import { serveStand } from '@runlith/e2e/stand';
import { artifactDirectory } from '@runlith/e2e/artifacts';
import { Data, Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, loadavg, release } from 'node:os';
import { evidence, type Evidence } from './evidence';
import { controlSource, ready, runScenario, type MotionSource } from './scenarios';
import { chromiumOnly, scenarioNames } from './scenario';
import { controls } from './controls';
import { displacement, type ControlEnvelope, type DisplacementEvidence } from './displacement';
import { checkHistorical } from './historical.fixture';

class BaselineFailed extends Data.TaggedError('BaselineFailed')<{ readonly message: string; readonly cause: unknown }> {}
const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new BaselineFailed({ message, cause }) });
type Result = { lane: string; scenario: string; evidence: Evidence; movement: DisplacementEvidence; artifacts: string };
type Calibration = { source: MotionSource; artifacts: string; envelope: ControlEnvelope };

const measure = Effect.fnUntraced(function* (url: string, lane: 'chromium' | 'webkit') {
  const files = yield* FileSystem.FileSystem;
  const fixture = yield* session(
    lane,
    { viewport: { width: 1280, height: 900 }, hasTouch: true },
    { own: 'detached branch-base measurement' },
  );
  if (fixture.cdp !== undefined)
    yield* attempted('CPU throttling failed', () => fixture.cdp!.send('Emulation.setCPUThrottlingRate', { rate: 4 }));
  const envelopes = new Map<MotionSource, ControlEnvelope>();
  const calibrations: Calibration[] = [];
  const results: Result[] = [];
  for (const name of scenarioNames) {
    if (lane === 'webkit' && chromiumOnly.includes(name)) continue;
    const source = controlSource(name, fixture.cdp);
    let envelope = source === undefined ? undefined : envelopes.get(source);
    if (source !== undefined && envelope === undefined) {
      const measured = yield* attempted(`${lane}:${source}: control flings failed`, () => controls(fixture.page, fixture.cdp, url, source));
      envelope = measured.envelope;
      envelopes.set(source, envelope);
      const artifacts = artifactDirectory(Bun.main, `${lane}-${source}-controls`);
      yield* files.writeFileString(join(artifacts, 'controls.json'), JSON.stringify(measured));
      calibrations.push({ source, artifacts, envelope });
      console.log(JSON.stringify({ lane, source, controls: envelope.controls, discarded: envelope.discarded, artifacts }));
    }
    yield* attempted(`${name}: the stand did not load`, async () => {
      await fixture.page.goto(url);
      await ready(fixture.page);
    });
    const recording = yield* attempted(`${name}: the driver failed`, () => runScenario(fixture.page, fixture.cdp, name));
    const result = evidence(recording);
    const movement = displacement(recording, envelope);
    const artifacts = artifactDirectory(Bun.main, `${lane}-${name}`);
    yield* files.writeFileString(join(artifacts, 'frames.json'), JSON.stringify(recording));
    const row = { lane, scenario: name, evidence: result, movement, artifacts };
    results.push(row);
    console.log(
      JSON.stringify({
        ...row,
        movement: { maxError: movement.maxError, failures: movement.failures.length, unchecked: movement.unchecked.length },
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
  const chromium = yield* Effect.scoped(measure(served.url(), 'chromium'));
  const webkit = yield* Effect.scoped(measure(served.url(), 'webkit'));
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
      browsers: { chromium: chromium.browser, webkit: webkit.browser },
      scenarios: chromium.results.length + webkit.results.length,
    }),
  );
});
await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(BunFileSystem.layer)));
