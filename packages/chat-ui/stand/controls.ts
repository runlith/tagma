import type { CDPSession, Page } from 'playwright-core';
import type { MeasuredControl, Recording } from './recording';
import type { StandGlobal } from './port';
import { fling, ready } from './scenarios';
import { controlEnvelope, type ControlEnvelope } from './displacement';

export type Controls = { recordings: Recording[]; discarded: { name: string; reason: string }[]; reach: number; envelope: ControlEnvelope };
export type ControlRegion = { measured: MeasuredControl; reach: number };

export async function controls(
  page: Page,
  cdp: CDPSession | undefined,
  url: string,
  source: 'touch' | 'wheel' = cdp === undefined ? 'wheel' : 'touch',
): Promise<Controls> {
  await page.goto(new URL('?loaded=10000', url).href);
  await ready(page);
  return measureControls(page, cdp, source);
}

export async function prepareControls(page: Page): Promise<ControlRegion> {
  await page.locator('[data-scrollable][role="group"]').hover();
  await page.mouse.wheel(0, -1800);
  await page.evaluate(() => (globalThis as StandGlobal).feedStand!.frames(8));
  const reach = 12000;
  const measured = await page.evaluate((reach) => (globalThis as StandGlobal).feedStand!.warm(reach), reach);
  return { measured, reach };
}

export async function recordControl(
  page: Page,
  cdp: CDPSession | undefined,
  region: ControlRegion,
  name: string,
  source: 'touch' | 'wheel' = cdp === undefined ? 'wheel' : 'touch',
): Promise<Recording> {
  await page.evaluate(
    async ({ start, name }) => {
      const port = (globalThis as StandGlobal).feedStand!;
      await port.position(start);
      port.start(name);
    },
    { start: region.measured.start, name },
  );
  await fling(page, cdp, source, 5000);
  await page.evaluate(() => (globalThis as StandGlobal).feedStand!.frames(45));
  return page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop());
}

export async function measureControls(
  page: Page,
  cdp: CDPSession | undefined,
  source: 'touch' | 'wheel' = cdp === undefined ? 'wheel' : 'touch',
): Promise<Controls> {
  const region = await prepareControls(page);
  const recordings: Recording[] = [];
  const discarded: Controls['discarded'] = [];
  const candidates: Recording[] = [];
  let envelope = controlEnvelope(candidates);
  while (envelope.status !== 'ready') {
    const recording = await recordControl(page, cdp, region, `control-${recordings.length + 1}`, source);
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
  }
  return { recordings, discarded, reach: region.reach, envelope };
}
