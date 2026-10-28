import type { CDPSession, Page } from 'playwright-core';
import type { Recording, ThumbReference } from './recording';
import type { StandGlobal } from './port';
import type { DisclosurePosition, ScenarioName } from './scenario';
import { dragThumb, prepareThumb } from './thumb';

export type MotionSource = 'touch' | 'wheel';
export const motionSource = (name: ScenarioName, cdp: CDPSession | undefined): MotionSource =>
  cdp === undefined || name === 'fling-wheel' ? 'wheel' : 'touch';
export const controlSource = (name: ScenarioName, cdp: CDPSession | undefined): MotionSource | undefined =>
  cdp !== undefined && name.includes('fling') ? motionSource(name, cdp) : undefined;

export type ScenarioOptions = { readonly jump: string; readonly thumb?: ThumbReference };
type PageLanding = { loaded: boolean; time: number; height: number };

export class ScenarioFailure extends Error {
  constructor(
    message: string,
    readonly recording: Recording,
  ) {
    super(message);
    this.name = 'ScenarioFailure';
  }
}

async function refuse(page: Page, message: string): Promise<never> {
  throw new ScenarioFailure(message, await page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop()));
}

const approach = (page: Page, distance: number): Promise<void> =>
  page.evaluate((distance) => (globalThis as StandGlobal).feedStand!.approach(distance), distance);
const DRAG_DISTANCE = 480;
const FLING_DISTANCE = 1400;
const frames = (page: Page, count = 1): Promise<void> =>
  page.evaluate((count) => (globalThis as StandGlobal).feedStand!.frames(count), count);
const start = (page: Page, name: string): Promise<void> =>
  page.evaluate((name) => (globalThis as StandGlobal).feedStand!.start(name), name);

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as StandGlobal).feedStand?.ready === true);
  await page.locator('[data-timeline-key]').first().waitFor({ state: 'attached' });
}

export async function fling(
  page: Page,
  cdp: CDPSession | undefined,
  source: 'touch' | 'wheel',
  distance = 5000,
  preventFling = false,
  speed = 2200,
  afterRelease?: () => Promise<void>,
): Promise<void> {
  const { x, y } = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.point());
  if (cdp !== undefined) {
    await frames(page, 2);
    await page.evaluate(
      ({ distance, speed, preventFling }) => (globalThis as StandGlobal).feedStand!.beginDrag(distance, speed, preventFling),
      { distance, speed, preventFling },
    );
    const released =
      afterRelease === undefined
        ? undefined
        : source === 'touch'
          ? page.evaluate(() => (globalThis as StandGlobal).feedStand!.released()).then(afterRelease)
          : frames(page, 3).then(afterRelease);
    await Promise.all([
      cdp.send('Input.synthesizeScrollGesture', {
        x,
        y,
        yDistance: distance,
        speed,
        gestureSourceType: source === 'wheel' ? 'mouse' : 'touch',
        preventFling,
      }),
      released,
    ]);
    await frames(page, 2);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.endDrag());
  } else {
    await page.mouse.move(x, y);
    await frames(page, 2);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.beginWheel());
    for (let step = 0; step < 12; step += 1) {
      await page.mouse.wheel(0, -distance / 12);
      await frames(page);
    }
    await afterRelease?.();
    await frames(page, 2);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.endWheel());
  }
}

async function pause(page: Page): Promise<void> {
  const { x, y } = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.point());
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -1800);
  await frames(page, 8);
  await page.waitForFunction(() => {
    const state = (globalThis as StandGlobal).feedStand!.state();
    return state.height - state.viewport - state.top > state.viewport;
  });
}

async function toggleDisclosure(page: Page): Promise<void> {
  const point = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.disclosurePoint());
  await page.mouse.click(point.x, point.y);
}

async function disclosure(page: Page, name: ScenarioName): Promise<void> {
  const side = name.slice('disclosure-'.length) as DisclosurePosition;
  await page.evaluate((side) => (globalThis as StandGlobal).feedStand!.positionDisclosure(side), side);
  await start(page, name);
  await toggleDisclosure(page);
  await frames(page, 12);
  await toggleDisclosure(page);
  await frames(page, 16);
}

export async function runScenario(
  page: Page,
  cdp: CDPSession | undefined,
  name: ScenarioName,
  options: ScenarioOptions = { jump: 'jumpToLatest' },
): Promise<Recording> {
  if (name === 'thumb-history') {
    if (cdp === undefined) throw new Error('Native thumb history requires the Chromium lane');
    const recording = await dragThumb(page, options.thumb ?? (await prepareThumb(page)));
    if (!recording.frames.some((frame) => frame.mounts.some((mount) => !mount.measured)))
      throw new ScenarioFailure('The native thumb trial crossed no unmeasured history', recording);
    return recording;
  }
  if ((name === 'fling-touch' || name === 'drag-page-landing') && cdp === undefined)
    throw new Error('A known touch gesture requires the Chromium CDP lane');
  if (['streaming-paused', 'latest', 'width', 'keyboard', 'drag-page-landing'].includes(name) || name.startsWith('disclosure-'))
    await pause(page);
  if (name === 'drag-page-landing') await approach(page, DRAG_DISTANCE);
  if (name === 'page-mid-fling') await approach(page, FLING_DISTANCE);
  if (!name.startsWith('disclosure-')) await start(page, name);
  if (name === 'open-tail') {
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.remount());
    await frames(page, 30);
  }
  if (name === 'fling-wheel' || name === 'fling-touch') {
    await fling(page, cdp, motionSource(name, cdp));
    await frames(page, 45);
  }
  let pageLanding: PageLanding | undefined;
  if (name === 'drag-page-landing') {
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.pageLatency(220));
    const landing = page.evaluate(async (): Promise<PageLanding> => {
      const port = (globalThis as StandGlobal).feedStand!;
      await port.pressed();
      const before = port.state().height;
      const loaded = await port.loadOlder();
      return { loaded, time: performance.now(), height: before };
    });
    const [landed] = await Promise.all([landing, fling(page, cdp, 'touch', DRAG_DISTANCE, true, 240)]);
    pageLanding = landed;
    if (!landed.loaded) return refuse(page, 'The older page did not land inside the drag');
    await page.evaluate(async (height) => {
      const port = (globalThis as StandGlobal).feedStand!;
      while (port.state().height <= height) await port.frames();
    }, landed.height);
    await frames(page, 12);
  }
  if (name === 'page-mid-fling') {
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.pageLatency(20));
    let loaded = true;
    await fling(page, cdp, motionSource(name, cdp), FLING_DISTANCE, false, 2200, async () => {
      loaded = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.loadOlder());
    });
    if (!loaded) return refuse(page, 'The scripted older page did not land after touch release');
    await frames(page, 35);
  }
  if (name === 'streaming-paused') {
    await frames(page, 2);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.stream(24));
    await frames(page, 12);
  }
  if (name === 'rail-during-fling') {
    await fling(page, cdp, motionSource(name, cdp), 1400, false, 2200, async () => {
      await page.locator('[role="navigation"] button').nth(4).click();
    });
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.landed());
    await frames(page, 12);
  }
  if (name === 'latest') {
    await page.getByRole('button', { name: options.jump, exact: true }).click();
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.landed());
    await frames(page, 12);
  }
  if (name.startsWith('disclosure-')) await disclosure(page, name);
  if (name === 'width') {
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.resize(640, 900));
    await frames(page, 20);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.resize(1280, 900));
    await frames(page, 20);
  }
  if (name === 'keyboard') {
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.resize(1280, 540));
    await frames(page, 20);
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.resize(1280, 900));
    await frames(page, 20);
  }
  const recording = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop());
  const initial = recording.frames[0];
  if (pageLanding !== undefined) {
    const release = recording.touches.find((touch) => touch.type === 'touchend');
    const sampled =
      recording.timings !== undefined
        ? recording.timings.length > 0
        : initial !== undefined &&
          recording.frames.some(
            (frame) => frame.touching && frame.tiles > initial.tiles && release !== undefined && frame.sampled < release.timeStamp,
          );
    if (release === undefined || pageLanding.time >= release.timeStamp || !sampled)
      throw new ScenarioFailure('The older page did not enter the DOM while the finger was held', recording);
    const reachable = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.reachOlder());
    if (!reachable) throw new ScenarioFailure('The older page first message was not reachable after release', recording);
  }
  return recording;
}
