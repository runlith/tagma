import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { onFailure } from '@runlith/e2e/artifacts';
import { stand } from '@runlith/e2e/stand';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidence } from './evidence';
import type { Recording } from './recording';
import { CalibrationFailure } from './thumb';
import { controlSource, ready, runScenario, ScenarioFailure, type ScenarioOptions } from './scenarios';
import { chromiumOnly, scenarioNames, type ScenarioName } from './scenario';
import { controls, heldControls, type Controls } from './controls';
import { displacement, type ControlEnvelope } from './displacement';
import { TouchCalibrationFailure, type HeldTouch } from './held';
import { observeInput, readInput } from './input.fixture';

const served = stand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)));
const envelopes = new Map<string, ControlEnvelope>();
const win32Scenarios: readonly ScenarioName[] = [
  'fling-touch',
  'drag-page-landing',
  'page-mid-fling',
  'rail-during-fling',
  'thumb-history',
];

function anchorDrift(recording: Recording): number {
  const first = recording.frames[0];
  if (first === undefined) throw new Error('The recorder sampled no frames');
  const anchor = first.rows.findLast((row) => row.rect.top <= first.line);
  if (anchor === undefined) throw new Error('No DOM row crossed the reading line');
  let drift = 0;
  for (const frame of recording.frames) {
    const row = frame.rows.find((row) => row.key === anchor.key);
    if (row === undefined) throw new Error(`The reader's anchor ${anchor.key} was unmounted`);
    drift = Math.max(drift, Math.abs(row.rect.top - anchor.rect.top));
  }
  return drift;
}

type ContactState = { target: Element | null; terminal: string | null };
type ContactGlobal = typeof globalThis & { contactState?: ContactState };

e2e(
  'records touch termination after the pressed descendant leaves the DOM',
  async ({ page, touch, artifacts }) => {
    if (touch === undefined) throw new Error('The touch lifecycle regression requires native touch input');
    await page.goto(served.url());
    await ready(page);
    await page.evaluate(() => {
      const state: ContactState = { target: null, terminal: null };
      (globalThis as ContactGlobal).contactState = state;
      const root = document.querySelector('[data-scrollable][role="group"]')!;
      root.addEventListener(
        'touchstart',
        (event) => {
          if (!(event.target instanceof Element) || event.target === root || event.target.closest('[data-timeline-key]') === null)
            throw new Error('The contact must start on a rendered row descendant');
          state.target = event.target;
          for (const type of ['touchend', 'touchcancel'])
            state.target.addEventListener(
              type,
              (ended) => {
                state.terminal = ended.type;
              },
              { once: true, passive: true },
            );
        },
        { once: true, capture: true, passive: true },
      );
      window.feedStand!.start('detached-touch-target');
    });
    const point = await page.evaluate(() => window.feedStand!.point());
    try {
      await touch.press(point);
      await page.evaluate(async () => {
        await window.feedStand!.pressed();
        await window.feedStand!.frames(2);
        const target = (globalThis as ContactGlobal).contactState!.target;
        if (target === null) throw new Error('No trusted touch target was observed');
        target.remove();
      });
    } finally {
      await touch.release();
    }
    await page.waitForFunction(() => (globalThis as ContactGlobal).contactState?.terminal != null);
    const captured = await page.evaluate(async () => {
      await window.feedStand!.frames(2);
      const state = (globalThis as ContactGlobal).contactState!;
      return { terminal: state.terminal, connected: state.target!.isConnected, recording: window.feedStand!.stop() };
    });
    await writeFile(join(artifacts, 'contact.json'), JSON.stringify(captured));
    expect(captured.connected).toBe(false);
    expect(captured.recording.touches.map((event) => event.type)).toEqual(['touchstart', captured.terminal!]);
    expect(captured.recording.frames.at(-1)!.touching).toBe(false);
  },
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 900 }, hasTouch: true } },
);

for (const lane of ['chromium', 'webkit'] as const)
  for (const branch of lane === 'chromium' ? (['host', 'Win32'] as const) : (['host'] as const))
    for (const name of scenarioNames.filter(
      (name) => (lane === 'chromium' || !chromiumOnly.includes(name)) && (branch === 'host' || win32Scenarios.includes(name)),
    )) {
      e2e(
        `native feed (${branch}): ${name}`,
        async ({ page, context, cdp, touch, artifacts }) => {
          await observeInput(context);
          if (branch === 'Win32')
            await context.addInitScript(() => {
              Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            });
          const framesFile = `frames-${branch}.json`;
          const thumbFile = `thumb-control-${branch}.json`;
          if (cdp !== undefined) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          const source = controlSource(name, cdp);
          const controlKey = source === undefined ? undefined : `${lane}:${branch}:${source}`;
          if (source !== undefined && controlKey !== undefined && !envelopes.has(controlKey)) {
            let measured: Controls | undefined;
            const save = () => writeFile(join(artifacts, `controls-${branch}.json`), JSON.stringify({ lane, branch, source, measured }));
            const stop = onFailure(save);
            try {
              measured = await controls(page, cdp, served.url(), source, (reading) => {
                measured = reading;
              });
              const envelope = measured.envelope;
              envelopes.set(controlKey, envelope);
              await save();
              console.log(JSON.stringify({ lane, branch, source, controls: envelope.controls, discarded: envelope.discarded }));
            } finally {
              stop();
            }
          }
          let held: HeldTouch | undefined;
          if (name === 'drag-page-landing') {
            const heldFile = `held-control-${branch}.json`;
            try {
              held = await heldControls(page, served.url(), touch);
            } catch (error) {
              if (!(error instanceof TouchCalibrationFailure)) throw error;
              await writeFile(join(artifacts, heldFile), JSON.stringify({ lane, branch, ...error.evidence }));
              throw new Error(`${error.message}; evidence: ${heldFile}`);
            }
            await writeFile(join(artifacts, heldFile), JSON.stringify({ lane, branch, ...held.calibration }));
            console.log(JSON.stringify({ lane, branch, held: { path: held.calibration.path, slop: held.calibration.slop } }));
          }
          const options: ScenarioOptions = { jump: 'jumpToLatest', held };
          await page.goto(served.url());
          await ready(page);
          let recording: Recording;
          let failure: string | undefined;
          try {
            recording = await runScenario(page, cdp, name, options);
          } catch (error) {
            if (error instanceof CalibrationFailure) {
              await writeFile(join(artifacts, thumbFile), JSON.stringify({ lane, branch, control: error.control, trial: error.trial }));
              throw new Error(`${error.message}; evidence: ${thumbFile}`);
            }
            if (!(error instanceof ScenarioFailure)) throw error;
            recording = error.recording;
            failure = error.message;
          }
          const result = evidence(recording);
          const movement = displacement(
            recording,
            controlKey === undefined ? undefined : envelopes.get(controlKey),
            lane === 'webkit' ? 'causal-late' : 'full',
          );
          await writeFile(join(artifacts, framesFile), JSON.stringify({ lane, branch, recording, result, movement }));
          await writeFile(join(artifacts, `input-${branch}.json`), JSON.stringify(await readInput(page)));
          console.log(
            JSON.stringify({
              lane,
              branch,
              scenario: name,
              ...result,
              displacement: {
                maxError: movement.maxError,
                lateWheels: movement.lateWheels.filter((step) => step.kind === 'wheel-late').length,
                postWriteWheels: movement.lateWheels.filter((step) => step.kind === 'wheel-after-write').length,
                cumulativeDrift: movement.cumulativeDrift,
                failures: movement.failures.length,
                unchecked: movement.unchecked.length,
                firstFailures: movement.failures.slice(0, 3),
                firstUnchecked: movement.unchecked.slice(0, 3),
              },
            }),
          );
          if (failure !== undefined) throw new Error(`${failure}; evidence: ${framesFile}`);
          expect(result.frames).toBeGreaterThan(2);
          expect(result.missingFrames).toBe(0);
          expect(result.comparisons).toBeGreaterThan(0);
          expect(result.maxBlank).toBe(0);
          expect(result.boxComparisons).toBeGreaterThan(0);
          expect(result.unknownBoxes).toBe(0);
          expect(result.maxBoxError).toBeLessThanOrEqual(0.5);
          expect(result.unknownRail).toBe(0);
          expect(result.railMismatches).toBe(0);
          expect(movement.failures.length).toBe(0);
          expect(movement.unchecked.length).toBe(0);
          expect(movement.causes.failures).toEqual([]);
          expect(movement.causes.unchecked).toEqual([]);
          if (name === 'disclosure-at') {
            const control = recording.frames[0]?.control;
            expect(control).not.toBeNull();
            for (const frame of recording.frames) {
              expect(frame.control).not.toBeNull();
              expect(Math.abs(frame.control!.top - control!.top)).toBeLessThanOrEqual(0.5);
            }
          }
          if (name === 'streaming-paused') expect(anchorDrift(recording)).toBeLessThanOrEqual(0.5);
          if (name === 'open-tail' || name === 'latest') {
            const state = await page.evaluate(() => window.feedStand!.state());
            expect(Math.abs(state.height - state.viewport - state.top)).toBeLessThanOrEqual(1 / recording.frames.at(-1)!.dpr);
          }
        },
        { lanes: [lane], context: { viewport: { width: 1280, height: 900 }, hasTouch: name !== 'thumb-history' } },
      );
    }
