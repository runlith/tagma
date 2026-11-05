import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { measureControls, measureHeld } from '@runlith/chat-ui/testing/stand/controls';
import { displacement, type ControlEnvelope } from '@runlith/chat-ui/testing/stand/displacement';
import { evidence } from '@runlith/chat-ui/testing/stand/evidence';
import type { StandGlobal } from '@runlith/chat-ui/testing/stand/port';
import type { Recording } from '@runlith/chat-ui/testing/stand/recording';
import { chromiumOnly, scenarioNames, type ScenarioName } from '@runlith/chat-ui/testing/stand/scenario';
import {
  controlSource,
  runScenario,
  ScenarioFailure,
  type EngineInput,
  type ScenarioOptions,
} from '@runlith/chat-ui/testing/stand/scenarios';
import { CalibrationFailure } from '@runlith/chat-ui/testing/stand/thumb';
import { e2e } from '@runlith/e2e/browser';
import type { Touch } from '@runlith/e2e/touch';
import { Effect, FileSystem } from 'effect';
import type { Page } from 'playwright-core';
import { join } from 'node:path';
import { appFeed, JUMP, reopen, visit } from './feedWorld.js';

const feed = appFeed();
const context = { viewport: { width: 1440, height: 900 }, hasTouch: true };
const envelopes = new Map<string, ControlEnvelope>();
const port = (page: Page) => ({
  frames: (count: number) => Effect.promise(() => page.evaluate((count) => (globalThis as StandGlobal).feedStand!.frames(count), count)),
  stop: () => Effect.promise(() => page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop())),
  state: () => Effect.promise(() => page.evaluate(() => (globalThis as StandGlobal).feedStand!.state())),
});

const scenario = Effect.fnUntraced(function* (
  page: Page,
  input: EngineInput,
  name: ScenarioName,
  artifacts: string,
  options: ScenarioOptions,
) {
  const outcome = yield* Effect.promise(() =>
    runScenario(page, input, name, options).then(
      (recording) => ({ recording }),
      (failure: unknown) => ({ failure }),
    ),
  );
  if ('recording' in outcome) return outcome.recording;
  if (outcome.failure instanceof CalibrationFailure)
    yield* (yield* FileSystem.FileSystem).writeFileString(
      join(artifacts, 'thumb-control.json'),
      JSON.stringify({ control: outcome.failure.control, trial: outcome.failure.trial }),
    );
  if (outcome.failure instanceof ScenarioFailure)
    yield* (yield* FileSystem.FileSystem).writeFileString(
      join(artifacts, 'frames.json'),
      JSON.stringify({ recording: outcome.failure.recording }),
    );
  return yield* Effect.die(outcome.failure);
}, Effect.provide(BunFileSystem.layer));

const calibrated = Effect.fnUntraced(function* (lane: string, name: ScenarioName, page: Page, input: EngineInput, artifacts: string) {
  const source = controlSource(name, input.cdp);
  if (source === undefined) return undefined;
  const key = `${lane}:${source}`;
  const known = envelopes.get(key);
  if (known !== undefined) return known;
  const measured = yield* Effect.promise(() => measureControls(page, input, source));
  const envelope = measured.envelope;
  envelopes.set(key, envelope);
  yield* (yield* FileSystem.FileSystem).writeFileString(join(artifacts, 'controls.json'), JSON.stringify({ measured, envelope }));
  console.log(JSON.stringify({ lane, source, controls: envelope.controls, discarded: envelope.discarded }));
  return envelope;
}, Effect.provide(BunFileSystem.layer));

const heldControl = Effect.fnUntraced(function* (page: Page, touch: Touch | undefined, artifacts: string) {
  const held = yield* Effect.promise(() => measureHeld(page, touch));
  yield* (yield* FileSystem.FileSystem).writeFileString(join(artifacts, 'held-control.json'), JSON.stringify(held.calibration));
  console.log(JSON.stringify({ lane: 'app', held: { path: held.calibration.path, slop: held.calibration.slop } }));
  return held;
}, Effect.provide(BunFileSystem.layer));

const judge = Effect.fnUntraced(function* (artifacts: string, recording: Recording, envelope: ControlEnvelope | undefined) {
  const result = evidence(recording);
  const movement = displacement(recording, envelope);
  yield* (yield* FileSystem.FileSystem).writeFileString(join(artifacts, 'frames.json'), JSON.stringify({ recording, result, movement }));
  console.log(
    JSON.stringify({
      lane: 'app',
      scenario: recording.name,
      ...result,
      displacement: {
        anchorComparisons: movement.anchorComparisons,
        failures: movement.failures.length,
        unchecked: movement.unchecked.length,
        firstFailures: movement.failures.slice(0, 3),
        firstUnchecked: movement.unchecked.slice(0, 3),
      },
      causes: {
        changes: movement.causes.changes.length,
        failures: movement.causes.failures.length,
        unchecked: movement.causes.unchecked.length,
        firstFailures: movement.causes.failures.slice(0, 3),
        firstUnchecked: movement.causes.unchecked.slice(0, 3),
      },
    }),
  );
  expect(result.frames).toBeGreaterThan(2);
  expect(result.comparisons).toBeGreaterThan(0);
  if (recording.name !== 'width') expect(result.railFrames).toBeGreaterThan(0);
  expect(result.maxBlank).toBe(0);
  expect(result.boxComparisons).toBeGreaterThan(0);
  expect(result.unknownBoxes).toBe(0);
  expect(result.maxBoxError).toBeLessThanOrEqual(0.5);
  expect(result.unknownRail).toBe(0);
  expect(result.railMismatches).toBe(0);
  expect(movement.failures).toEqual([]);
  expect(movement.unchecked).toEqual([]);
  expect(movement.causes.failures).toEqual([]);
  expect(movement.causes.unchecked).toEqual([]);
}, Effect.provide(BunFileSystem.layer));

for (const lane of ['chromium', 'webkit'] as const) {
  e2e.effect(
    'real app feed: cold opening',
    ({ page, cdp, artifacts }) =>
      Effect.gen(function* () {
        yield* visit(page, cdp, feed(), { opening: true });
        yield* port(page).frames(30);
        yield* judge(artifacts, yield* port(page).stop(), undefined);
      }),
    { lanes: [lane], context },
  );
  for (const name of scenarioNames.filter((name: ScenarioName) => lane === 'chromium' || !chromiumOnly.includes(name))) {
    e2e.effect(
      `real app feed: ${name}`,
      ({ page, cdp, touch, artifacts }) =>
        Effect.gen(function* () {
          yield* visit(page, cdp, feed(), { opening: false });
          const envelope = yield* calibrated(lane, name, page, { cdp, touch }, artifacts);
          const held = name === 'drag-page-landing' ? yield* heldControl(page, touch, artifacts) : undefined;
          if (envelope !== undefined || held !== undefined) yield* reopen(page, feed());
          const recording = yield* scenario(page, { cdp, touch }, name, artifacts, { jump: JUMP, held });
          yield* judge(artifacts, recording, envelope);
          if (name !== 'open-tail' && name !== 'latest') return;
          const state = yield* port(page).state();
          expect(Math.abs(state.height - state.viewport - state.top)).toBeLessThanOrEqual(1 / recording.frames.at(-1)!.dpr);
        }),
      { lanes: [lane], context },
    );
  }
}
