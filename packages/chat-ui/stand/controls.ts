import type { Touch } from '@runlith/e2e/touch';
import type { Page } from 'playwright-core';
import type { MeasuredControl, Recording } from './recording';
import type { StandGlobal } from './port';
import { fling, ready, type EngineInput } from './scenarios';
import { controlEnvelope, type ControlEnvelope } from './displacement';
import { calibrateHeld, type HeldTouch } from './held';
import { browserStand } from './standPage';

export type Controls = { recordings: Recording[]; discarded: { name: string; reason: string }[]; reach: number; envelope: ControlEnvelope };
export type ControlRegion = { measured: MeasuredControl; reach: number };
export type ControlObserver = (reading: Controls) => void;

export async function controls(
  page: Page,
  input: EngineInput,
  url: string,
  source: 'touch' | 'wheel' = input.cdp === undefined ? 'wheel' : 'touch',
  observe?: ControlObserver,
): Promise<Controls> {
  await page.goto(new URL('?loaded=10000', url).href);
  await ready(page);
  return measureControls(page, input, source, observe);
}

export async function prepareControls(page: Page): Promise<ControlRegion> {
  await page.locator('[data-scrollable][role="group"]').hover();
  await page.mouse.wheel(0, -1800);
  await page.evaluate(async () => {
    const port = (globalThis as StandGlobal).feedStand!;
    await port.wheelSettled();
    await port.frames(8);
  });
  const reach = 12000;
  const measured = await page.evaluate((reach) => (globalThis as StandGlobal).feedStand!.warm(reach), reach);
  return { measured, reach };
}

export async function heldControls(page: Page, url: string, touch: Touch | undefined): Promise<HeldTouch> {
  await page.goto(new URL('?loaded=10000', url).href);
  await ready(page);
  return measureHeld(page, touch);
}

export async function measureHeld(page: Page, touch: Touch | undefined): Promise<HeldTouch> {
  if (touch === undefined) throw new Error('A held touch calibration requires a Chromium context with touch');
  const region = await prepareControls(page);
  return { touch, calibration: await calibrateHeld(browserStand(page), touch, region.measured) };
}

export async function recordControl(
  page: Page,
  input: EngineInput,
  region: ControlRegion,
  name: string,
  source: 'touch' | 'wheel' = input.cdp === undefined ? 'wheel' : 'touch',
): Promise<Recording> {
  await page.evaluate(
    async ({ start, name }) => {
      const port = (globalThis as StandGlobal).feedStand!;
      await port.position(start);
      port.start(name);
    },
    { start: region.measured.start, name },
  );
  await fling(page, input, source, 5000);
  await page.evaluate(() => (globalThis as StandGlobal).feedStand!.frames(45));
  return page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop());
}

export async function measureControls(
  page: Page,
  input: EngineInput,
  source: 'touch' | 'wheel' = input.cdp === undefined ? 'wheel' : 'touch',
  observe?: ControlObserver,
): Promise<Controls> {
  const region = await prepareControls(page);
  const recordings: Recording[] = [];
  const discarded: Controls['discarded'] = [];
  const candidates: Recording[] = [];
  let envelope = controlEnvelope(candidates);
  while (envelope.status !== 'ready') {
    const recording = await recordControl(page, input, region, `control-${recordings.length + 1}`, source);
    const changed = recording.frames.some((frame) => frame.sizeChanges > 0 || frame.unmeasured > 0);
    const outOfRange = recording.frames.some((frame) => frame.scrollTop < region.measured.from || frame.scrollTop > region.measured.to);
    if (changed || outOfRange)
      discarded.push({
        name: recording.name,
        reason: changed ? 'A row changed size or mounted without a measured DOM history' : 'The fling left its warmed region',
      });
    recordings.push(recording);
    if (!outOfRange) candidates.push(recording);
    envelope = controlEnvelope(candidates);
    observe?.({ recordings, discarded, reach: region.reach, envelope });
    const top = recording.frames[0]?.scrollTop;
    if (recording.frames.every((frame) => frame.scrollTop === top)) {
      const moves = recording.touches.filter((one) => one.type === 'touchmove').length;
      throw new Error(
        `The ${source} fling of ${recording.name} moved no content: scrollTop stayed ${top} while the page received ${moves} touchmove of ${recording.touches.length} touch events`,
      );
    }
  }
  return { recordings, discarded, reach: region.reach, envelope };
}
