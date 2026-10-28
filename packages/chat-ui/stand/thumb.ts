import type { Page } from 'playwright-core';
import type { StandGlobal } from './port';
import type { Frame, Recording, Sentinel, ThumbControl, ThumbReference, ThumbSample } from './recording';

const CONTROL_STEPS = 64;
const TRIAL_PORTIONS = 128;
const MOVE_STEPS = 3;

const frames = (page: Page, count = 1): Promise<void> =>
  page.evaluate((count) => (globalThis as StandGlobal).feedStand!.frames(count), count);

function visible(sentinel: Sentinel, frame: Frame): boolean {
  const rect = sentinel.rect;
  const viewport = frame.viewport;
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom &&
    rect.right > viewport.left &&
    rect.left < viewport.right
  );
}

export class CalibrationFailure extends Error {
  constructor(
    reason: string,
    readonly control: ThumbControl,
    readonly trial?: import('./recording').Scrollbar,
  ) {
    super(`Native thumb calibration refused: ${reason}`);
    this.name = 'CalibrationFailure';
  }
}

function reject(control: ThumbControl, reason: string): never {
  throw new CalibrationFailure(reason, control);
}

function scaleOf(control: ThumbControl): number {
  const { scrollbar, samples, recording } = control;
  const { frames } = recording;
  if (samples.length < 4 || frames.length < 4) reject(control, 'insufficient samples');
  if (recording.drags.length !== 0 || (recording.commands?.length ?? 0) !== 0)
    reject(control, 'the control includes another declared input');
  const baseline = frames[0]!;
  if (!Number.isFinite(baseline.dpr) || baseline.dpr <= 0) reject(control, 'invalid device pixel ratio');
  const tolerance = 1 / baseline.dpr;
  if (
    ![scrollbar.range, scrollbar.viewport, ...Object.values(scrollbar.track), baseline.scrollHeight].every(Number.isFinite) ||
    scrollbar.range <= 0 ||
    scrollbar.viewport <= 0 ||
    baseline.scrollHeight !== scrollbar.range + scrollbar.viewport
  )
    reject(control, 'invalid control geometry');
  const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
  const meanTop = samples.reduce((sum, sample) => sum + sample.top, 0) / samples.length;
  let covariance = 0;
  let variance = 0;
  for (const sample of samples) {
    if (![sample.y, sample.time, sample.top].every(Number.isFinite)) reject(control, 'non-finite sample');
    covariance += (sample.y - meanY) * (sample.top - meanTop);
    variance += (sample.y - meanY) ** 2;
  }
  const scale = covariance / variance;
  const extent = Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top));
  if (!Number.isFinite(scale) || scale <= 0 || extent < scrollbar.viewport * 2) reject(control, 'vacuous native movement');
  for (const sample of samples) {
    if (Math.abs(sample.top - meanTop - scale * (sample.y - meanY)) > tolerance) reject(control, 'nonlinear or quantized native mapping');
    if (sample.top <= 0 || sample.top >= scrollbar.range) reject(control, 'the control reached a range clamp');
  }
  for (let index = 0; index < frames.length; index += 1) {
    const current = frames[index]!;
    if (current.blank !== 0) reject(control, 'unmounted area entered the control viewport');
    if (current.unmeasured !== 0 || current.mounts.some((mount) => !mount.measured)) reject(control, 'an unmeasured row mounted');
    if (current.sizeChanges !== 0 || current.structure || current.scrollHeight !== baseline.scrollHeight)
      reject(control, 'the control includes a correction');
    if (current.dpr !== baseline.dpr || JSON.stringify(current.viewport) !== JSON.stringify(baseline.viewport))
      reject(control, 'the viewport or device pixel ratio changed');
    const previous = frames[index - 1];
    if (previous === undefined) continue;
    if (!Number.isFinite(current.time - previous.time) || current.time <= previous.time) reject(control, 'invalid frame interval');
    const rows = new Map(previous.rows.map((row) => [row.key, row]));
    for (const row of current.rows) {
      const before = rows.get(row.key);
      if (
        before !== undefined &&
        (before.rect.width !== row.rect.width ||
          before.rect.height !== row.rect.height ||
          JSON.stringify(before.signature) !== JSON.stringify(row.signature))
      )
        reject(control, 'a rendered row changed');
    }
    const before = new Map(previous.sentinels.map((sentinel) => [sentinel.id, sentinel]));
    let comparisons = 0;
    for (const sentinel of current.sentinels) {
      const held = before.get(sentinel.id);
      if (held === undefined || !visible(held, previous) || !visible(sentinel, current)) continue;
      if (held.row !== sentinel.row || held.text !== sentinel.text || !Number.isFinite(sentinel.rect.top - held.rect.top))
        reject(control, 'a text witness changed');
      if (Math.abs(sentinel.rect.top - held.rect.top + current.scrollTop - previous.scrollTop) > tolerance)
        reject(control, 'DOM text disagrees with native scrolling');
      comparisons += 1;
    }
    if (comparisons === 0) reject(control, 'a frame has no common DOM text witness');
  }
  const indices = new Map(frames.map((frame, index) => [frame.time, index]));
  let forward = false;
  let backward = false;
  let pauses = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1]!;
    const after = samples[index]!;
    const from = indices.get(before.time);
    const to = indices.get(after.time);
    if (
      from === undefined ||
      to === undefined ||
      to <= from ||
      frames[from]!.scrollTop !== before.top ||
      frames[to]!.scrollTop !== after.top
    )
      reject(control, 'a native sample has no matching DOM frame');
    const delta = after.y - before.y;
    forward ||= delta > 0;
    backward ||= delta < 0;
    if (delta === 0) pauses += 1;
    if (delta === 0 && Math.abs(after.top - before.top) > tolerance) reject(control, 'a held thumb moved without pointer movement');
    if (delta !== 0 && (after.top === before.top || Math.sign(after.top - before.top) !== Math.sign(delta)))
      reject(control, 'a native step stopped or reversed');
    if (Math.abs(after.top - before.top - scale * delta) > tolerance)
      reject(control, 'a native step disagrees with its calibrated distance');
    for (let frame = from + 1; frame <= to; frame += 1) {
      const movement = frames[frame]!.scrollTop - frames[frame - 1]!.scrollTop;
      if (
        !Number.isFinite(movement) ||
        (delta === 0 ? Math.abs(movement) > tolerance : movement * delta < 0 || Math.abs(movement) > Math.abs(scale * delta) + tolerance)
      )
        reject(control, 'a native step contains uncontrolled motion');
    }
    let witnesses = new Map(
      frames[from]!.sentinels.filter((sentinel) => visible(sentinel, frames[from]!)).map((sentinel) => [sentinel.id, sentinel]),
    );
    for (let frame = from + 1; frame <= to; frame += 1) {
      const current = frames[frame]!;
      const next = new Map<number, Sentinel>();
      for (const sentinel of current.sentinels) {
        const held = witnesses.get(sentinel.id);
        if (held !== undefined && held.row === sentinel.row && held.text === sentinel.text && visible(sentinel, current))
          next.set(sentinel.id, held);
      }
      witnesses = next;
    }
    if (witnesses.size === 0) reject(control, 'a native step has no full-span DOM witness');
  }
  if (!forward || !backward || pauses < 2) reject(control, 'both directions and held pauses were not observed');
  const thumb = scrollbar.track.height - scrollbar.range / scale;
  if (!Number.isFinite(thumb) || thumb <= 0 || thumb >= scrollbar.track.height) reject(control, 'the native travel is outside its track');
  return scale;
}

async function sample(page: Page, y: number): Promise<ThumbSample> {
  return page.evaluate(async (y) => {
    const port = (globalThis as StandGlobal).feedStand!;
    await port.frames();
    return { y, time: port.frameTime(), top: port.scrollbar().top };
  }, y);
}

export async function prepareThumb(page: Page): Promise<ThumbReference> {
  const initial = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.scrollbar());
  await page.mouse.move(initial.x, initial.track.top + initial.track.height / 2);
  await page.mouse.wheel(0, -1);
  await frames(page, 3);
  if (initial.range < initial.viewport * 24) throw new Error('Native thumb history needs at least twenty-four viewports of scroll range');
  const warmed = await page.evaluate((reach) => (globalThis as StandGlobal).feedStand!.warm(reach), initial.viewport * 10);
  await page.evaluate(async (top) => {
    const port = (globalThis as StandGlobal).feedStand!;
    await port.position(top);
    port.start('thumb-control');
    await port.frames(3);
  }, warmed.start);
  const scrollbar = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.scrollbar());
  const proportional = (scrollbar.track.height * scrollbar.viewport) / (scrollbar.range + scrollbar.viewport);
  let y = scrollbar.track.top + ((scrollbar.track.height - proportional) * scrollbar.top) / scrollbar.range + proportional / 2;
  const step = (scrollbar.viewport * scrollbar.track.height) / scrollbar.range / 16;
  const samples: ThumbSample[] = [];
  await page.mouse.move(scrollbar.x, y);
  samples.push(await sample(page, y));
  await page.mouse.down();
  try {
    samples.push(await sample(page, y));
    for (const direction of [-1, 1]) {
      for (let index = 0; index < CONTROL_STEPS; index += 1) {
        y += direction * step;
        await page.mouse.move(scrollbar.x, y);
        samples.push(await sample(page, y));
      }
      samples.push(await sample(page, y));
    }
  } finally {
    await page.mouse.up();
  }
  const recording = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop());
  const control: ThumbControl = { scrollbar, samples, recording };
  const scale = scaleOf(control);
  let interval = Infinity;
  for (let index = 1; index < recording.frames.length; index += 1)
    interval = Math.min(interval, recording.frames[index]!.time - recording.frames[index - 1]!.time);
  await page.evaluate((top) => (globalThis as StandGlobal).feedStand!.position(top), warmed.start);
  const trial = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.scrollbar());
  if (
    JSON.stringify(trial.track) !== JSON.stringify(scrollbar.track) ||
    trial.viewport !== scrollbar.viewport ||
    trial.range !== scrollbar.range
  )
    throw new CalibrationFailure('the native thumb left its calibrated range', control, trial);
  if (trial.top < trial.viewport * 17) throw new Error('The native thumb has insufficient history beyond its warmed control');
  return { scale, interval, trial, control: [control] };
}

const portion = (page: Page, distance: number, speed: number): Promise<void> =>
  page.evaluate(
    ({ distance, speed }) => {
      const port = (globalThis as StandGlobal).feedStand!;
      port.endDrag();
      port.beginDrag(distance, speed, true);
    },
    { distance, speed },
  );

export async function dragThumb(page: Page, reference: ThumbReference): Promise<Recording> {
  const { trial, scale, interval } = reference;
  const distance = trial.viewport / 8;
  const pointerStep = distance / scale / MOVE_STEPS;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(interval) || interval <= 0 || reference.control.length === 0)
    throw new Error('The native thumb reference has no usable scale or frame cadence');
  const speed = ((distance / MOVE_STEPS) * 1000) / interval;
  const thumb = trial.track.height - trial.range / scale;
  let y = trial.track.top + ((trial.track.height - thumb) * trial.top) / trial.range + thumb / 2;
  await page.mouse.move(trial.x, y);
  await page.evaluate(async () => {
    const port = (globalThis as StandGlobal).feedStand!;
    port.start('thumb-history');
    await port.frames(2);
    port.beginDrag(0, 0, true);
  });
  await page.mouse.down();
  try {
    await frames(page, 3);
    for (let index = 0; index < TRIAL_PORTIONS; index += 1) {
      await portion(page, distance, speed);
      for (let step = 0; step < MOVE_STEPS; step += 1) {
        y -= pointerStep;
        await page.mouse.move(trial.x, y);
        await frames(page);
      }
      await frames(page);
      if ((index + 1) % 8 === 0) {
        await portion(page, 0, 0);
        await frames(page, 3);
      }
    }
    await page.evaluate(() => (globalThis as StandGlobal).feedStand!.endDrag());
  } finally {
    await page.mouse.up();
  }
  await frames(page, 6);
  const recording = await page.evaluate(() => (globalThis as StandGlobal).feedStand!.stop());
  recording.thumb = reference;
  return recording;
}
