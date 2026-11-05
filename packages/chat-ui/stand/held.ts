import type { PagePoint, Touch } from '@runlith/e2e/touch';
import { Schema } from 'effect';
import { displacement, type DisplacementEvidence } from './displacement';
import type { Frame, MeasuredControl, Rect, Recording } from './recording';
import { Recording as RecordingSchema, Targets as TargetsSchema } from './recording.fixture';
import { act, call, type StandPage } from './standPage';

const MARGIN = 32;
const ESTABLISH = 48;
const STEPS = 6;
const PAN_STEPS = 12;
const REST_FRAMES = 3;
const HOLD_FRAMES = 12;
const SETTLED_FRAMES = 12;
const RIGIDITY = 0.5;

export type HeldPath = {
  readonly x: number;
  readonly top: number;
  readonly establish: number;
  readonly crossing: number;
  readonly continued: number;
};
export type HeldEvidence = {
  path: HeldPath;
  slop: number | null;
  prelude: Recording | null;
  control: Recording | null;
  movement: DisplacementEvidence | null;
};
export type HeldCalibration = {
  readonly path: HeldPath;
  readonly slop: number;
  readonly prelude: Recording;
  readonly control: Recording;
  readonly movement: DisplacementEvidence;
};
export type HeldTouch = { readonly touch: Touch; readonly calibration: HeldCalibration };
export type HeldTrial = {
  readonly recording: Recording;
  readonly expected: readonly number[];
  readonly pressedHeight: number;
  readonly loaded: boolean;
  readonly landed: number;
  readonly entry: number | null;
  readonly reachable: boolean;
  readonly refusal: string | null;
};

export class TouchCalibrationFailure extends Error {
  constructor(
    reason: string,
    readonly evidence: HeldEvidence,
  ) {
    super(`Held touch calibration refused: ${reason}`);
    this.name = 'TouchCalibrationFailure';
  }
}

const State = Schema.Struct({ top: Schema.Number, height: Schema.Number, viewport: Schema.Number });
const Landing = Schema.Struct({ loaded: Schema.Boolean, time: Schema.Number });

const frames = (stand: StandPage, count: number): Promise<void> => act(stand, (port, count) => port.frames(count), count);
const state = (stand: StandPage) => call(stand, (port) => port.state(), State, undefined);

async function stop(stand: StandPage): Promise<Recording> {
  const recording = await call(stand, (port) => port.stop(), RecordingSchema, undefined);
  for (const drag of recording.drags) {
    if (drag.distance === 0) continue;
    const from = recording.frames[drag.fromFrame];
    const to = recording.frames[drag.toFrame];
    drag.speed =
      from === undefined || to === undefined || to.time <= from.time
        ? Number.NaN
        : (Math.abs(drag.distance) * 1000) / (to.time - from.time);
  }
  return recording;
}
const viewportOf = async (stand: StandPage): Promise<Rect> =>
  (await call(stand, (port) => port.targets(), TargetsSchema, undefined)).viewport;
const point = (path: HeldPath, y: number): PagePoint => ({ x: path.x, y });

const segment = (stand: StandPage, distance: number, quantum?: number): Promise<void> =>
  act(
    stand,
    (port, input) => {
      port.endDrag();
      port.beginDrag(input.distance, input.distance === 0 ? 0 : 1, true, input.quantum);
    },
    { distance, quantum },
  );

const settle = (stand: StandPage, before: number): Promise<void> =>
  act(
    stand,
    async (port, input) => {
      while (port.state().top === input.before) await port.frames();
      let last = port.state().top;
      for (let still = 0; still < input.rest;) {
        await port.frames();
        const top = port.state().top;
        still = top === last ? still + 1 : 0;
        last = top;
      }
    },
    { before, rest: REST_FRAMES },
  );

async function establishPan(stand: StandPage, touch: Touch, path: HeldPath): Promise<void> {
  const before = (await state(stand)).top;
  await touch.press(point(path, path.top));
  for (let step = 1; step <= PAN_STEPS; step += 1) {
    await touch.move(point(path, path.top + (path.establish * step) / PAN_STEPS));
    await act(stand, async (port) => {
      await port.pressed();
      await port.frames(1);
    });
  }
  await settle(stand, before);
}

async function stroke(stand: StandPage, touch: Touch, path: HeldPath, from: number, distance: number, steps: number): Promise<void> {
  const before = (await state(stand)).top;
  for (let step = 1; step <= steps; step += 1) {
    await touch.move(point(path, from + (distance * step) / steps));
    await frames(stand, 1);
  }
  await settle(stand, before);
}

async function release(stand: StandPage, touch: Touch): Promise<void> {
  await touch.release();
  await act(stand, async (port) => {
    await port.released();
    port.endDrag();
  });
}

function pathIn(viewport: Rect): HeldPath {
  const top = Math.round(viewport.top + viewport.height * 0.25);
  const available = viewport.bottom - MARGIN - top - ESTABLISH;
  const crossing = Math.round(available * 0.65);
  const continued = Math.round(available * 0.25);
  if (crossing <= 0 || continued <= 0) throw new Error(`The feed viewport ${JSON.stringify(viewport)} leaves no room for a held drag`);
  return { x: viewport.left + viewport.width * 0.6, top, establish: ESTABLISH, crossing, continued };
}

function fits(path: HeldPath, viewport: Rect): boolean {
  return (
    path.x > viewport.left &&
    path.x < viewport.right &&
    path.top >= viewport.top &&
    path.top + path.establish + path.crossing + path.continued <= viewport.bottom
  );
}

function rigidShift(first: Frame, last: Frame): number | null {
  const tops = new Map(first.sentinels.map((sentinel) => [sentinel.id, sentinel.rect.top]));
  const deltas = last.sentinels.flatMap((sentinel) => {
    const top = tops.get(sentinel.id);
    return top === undefined ? [] : [sentinel.rect.top - top];
  });
  if (deltas.length === 0) return null;
  const low = Math.min(...deltas);
  const high = Math.max(...deltas);
  return high - low > RIGIDITY ? null : (low + high) / 2;
}

const structural = (recording: Recording): boolean =>
  recording.frames.some((frame) => frame.structure || frame.sizeChanges !== 0 || frame.unmeasured !== 0);

export async function calibrateHeld(stand: StandPage, touch: Touch, region: MeasuredControl): Promise<HeldCalibration> {
  const path = pathIn(await viewportOf(stand));
  const evidence: HeldEvidence = { path, slop: null, prelude: null, control: null, movement: null };
  const refuse = (reason: string): never => {
    throw new TouchCalibrationFailure(reason, evidence);
  };
  await act(stand, (port, top) => port.position(top), region.start);
  await act(stand, (port) => port.start('held-prelude'));
  await frames(stand, 2);
  await establishPan(stand, touch, path);
  const prelude = await stop(stand);
  evidence.prelude = prelude;
  await act(stand, (port) => {
    port.start('held-control');
    port.beginDrag(0, 0, true);
  });
  await frames(stand, 2);
  await segment(stand, path.crossing);
  await stroke(stand, touch, path, path.top + path.establish, path.crossing, STEPS);
  await segment(stand, 0);
  await frames(stand, HOLD_FRAMES);
  await release(stand, touch);
  await frames(stand, SETTLED_FRAMES);
  const control = await stop(stand);
  evidence.control = control;
  const movement = displacement(control);
  evidence.movement = movement;

  const first = prelude.frames[0];
  const last = prelude.frames.at(-1);
  if (first === undefined || last === undefined || prelude.frames.length < 3)
    return refuse('the pan-recognition prelude sampled too few frames');
  if (structural(prelude)) return refuse('the pan-recognition prelude changed structure');
  const shift = rigidShift(first, last);
  if (shift === null) return refuse('the pan-recognition prelude kept no rigid common DOM sentinel');
  if (Math.abs(shift - (first.scrollTop - last.scrollTop)) > 1 / last.dpr)
    return refuse(`the prelude DOM shift ${shift} disagrees with its scroll offset change`);
  if (shift <= 0) return refuse('the establishing move recognized no pan');
  const slop = path.establish - shift;
  evidence.slop = slop;
  if (slop < -1 / last.dpr) {
    const pressed = prelude.touches.find((one) => one.type === 'touchstart');
    const moved = prelude.touches.find((one) => one.type === 'touchmove');
    const gap = pressed === undefined || moved === undefined ? null : moved.timeStamp - pressed.timeStamp;
    return refuse(`the content moved ${shift} px for a ${path.establish} px establishing move; press-to-move gap ${gap} ms`);
  }
  if (structural(control)) return refuse('the known-distance control changed structure');
  if (movement.failures.length > 0 || movement.unchecked.length > 0)
    return refuse(
      `the known-distance control failed its displacement: ${JSON.stringify({ failures: movement.failures.slice(0, 3), unchecked: movement.unchecked.slice(0, 3) })}`,
    );
  const moving = movement.drags[1];
  if (control.drags.length !== 3 || moving === undefined || !moving.complete || moving.anchors.length === 0)
    return refuse('the known-distance control proved no full-span DOM anchor');
  return { path, slop, prelude, control, movement };
}

export async function dragPage(stand: StandPage, held: HeldTouch, name: string): Promise<HeldTrial> {
  const { touch, calibration } = held;
  const { path, slop } = calibration;
  const viewport = await viewportOf(stand);
  if (!fits(path, viewport))
    throw new Error(`The calibrated held path ${JSON.stringify(path)} leaves the trial feed viewport ${JSON.stringify(viewport)}`);
  const establish = path.establish - slop;
  const expected = [0, establish, path.crossing, 0, path.continued, 0];
  await act(stand, (port, distance) => port.approach(distance), establish + path.crossing);
  await act(
    stand,
    async (port, name) => {
      await port.holdPages();
      port.start(name);
      port.beginDrag(0, 0, true);
    },
    name,
  );
  await frames(stand, 2);
  const pressedHeight = (await state(stand)).height;
  await segment(stand, establish, path.establish / PAN_STEPS);
  await establishPan(stand, touch, path);
  await segment(stand, path.crossing);
  await stroke(stand, touch, path, path.top + path.establish, path.crossing, STEPS);
  await segment(stand, 0);
  const landing = await call(
    stand,
    async (port) => {
      await port.releasePages();
      const loaded = await port.loadOlder();
      const time = performance.now();
      if (loaded) await port.frames(1);
      return { loaded, time };
    },
    Landing,
    undefined,
  );
  await segment(stand, path.continued);
  await stroke(stand, touch, path, path.top + path.establish + path.crossing, path.continued, STEPS);
  await segment(stand, 0);
  await frames(stand, HOLD_FRAMES);
  await release(stand, touch);
  if (landing.loaded)
    await act(
      stand,
      async (port, height) => {
        while (port.state().height <= height) await port.frames();
      },
      pressedHeight,
    );
  await frames(stand, SETTLED_FRAMES);
  const recording = await stop(stand);
  const reachable = landing.loaded && (await call(stand, (port) => port.reachOlder(), Schema.Boolean, undefined));
  const released = recording.touches.find((one) => one.type === 'touchend');
  const hold = recording.drags[3];
  const initial = recording.frames[0];
  const found = initial === undefined ? -1 : recording.frames.findIndex((frame) => frame.tiles > initial.tiles);
  const entry = found < 0 ? null : found;
  const entered = entry === null ? undefined : recording.frames[entry];
  const underFinger =
    recording.timings !== undefined
      ? recording.timings.length > 0
      : entered !== undefined &&
        hold !== undefined &&
        released !== undefined &&
        entry! > hold.fromFrame &&
        entry! <= hold.toFrame &&
        entered.touching &&
        entered.sampled < released.timeStamp;
  const refusal = !landing.loaded
    ? 'The older page did not land while the finger was held'
    : released === undefined
      ? 'The held touch recorded no trusted release'
      : landing.time >= released.timeStamp
        ? `The older page landed at ${landing.time}, not before the release at ${released.timeStamp}`
        : !underFinger
          ? `The older page did not enter the DOM under the stationary held finger: entry frame ${entry}, hold ${JSON.stringify(hold)}`
          : !reachable
            ? 'The older page first message was not reachable after release'
            : null;
  return { recording, expected, pressedHeight, loaded: landing.loaded, landed: landing.time, entry, reachable, refusal };
}
