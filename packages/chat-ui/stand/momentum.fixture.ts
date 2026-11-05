import type { ScrollRecording } from '@runlith/e2e/ios';

export type Pace = { speed: number; span: number };
type FlingPace = Pace & { consecutive: boolean };
export type Motion = {
  distance: number;
  velocity: number;
  ratio: number;
  steps: number[];
  paces: FlingPace[];
  cadence: number;
  endSpeed: number;
};
export type Calibration = { count: number; minRatio: number; maxRatio: number; endSpeed: number };
export type MomentumVerdict = {
  ratio: number;
  floor: number;
  reversals: number;
  interruptions: number;
  unjudged: number;
  stoppingWrites: number;
  aboveFloor: boolean;
};
export type MomentumWrite = { time: number; from: number; to: number };
type Sample = { t: number; offset: number };

const missedPixels = 2;
const missedFrame = 1.5;
const floorShare = 0.5;

export function pace(frames: readonly Sample[], index: number, direction: number): Pace {
  const before = frames[index - 2];
  const middle = frames[index - 1];
  const after = frames[index];
  if (before === undefined || middle === undefined || after === undefined) throw new Error('A two-frame pace needs two earlier frames');
  if (middle.t <= before.t || after.t <= middle.t) throw new Error('Fling frame times did not increase');
  const span = after.t - before.t;
  return { speed: (direction * (after.offset - before.offset)) / span, span };
}

export function cadence(frames: readonly Sample[]): number {
  const intervals = frames.slice(1).map((frame, index) => frame.t - frames[index]!.t);
  if (intervals.length === 0) throw new Error('A frame cadence needs two frames');
  return intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]!;
}

export function motion(recording: ScrollRecording, until = Infinity): Motion {
  const release = recording.release;
  if (release === null || release.velocity === null || release.velocity === 0) throw new Error('A fling has no measured release velocity');
  const ended = recording.touches.find((touch) => touch.type === 'touchend' && touch.trusted);
  if (ended === undefined || ended.t !== release.t) throw new Error('A fling has no matching first trusted touchend');
  const direction = Math.sign(release.velocity);
  const frames = recording.frames.filter((frame) => frame.t > release.t && frame.t < until);
  const first = frames.findIndex((frame) => frame.offset !== release.offset);
  if (first < 0) throw new Error('A fling never moved after release');
  const frameCadence = cadence(frames);
  const missed = (index: number) => index > 0 && frames[index]!.t - frames[index - 1]!.t >= missedFrame * frameCadence;
  const steps: number[] = [];
  const paces: FlingPace[] = [];
  for (let index = first + 1; index < frames.length; index += 1) {
    const before = frames[index - 1]!;
    const after = frames[index]!;
    if (after.t <= before.t) throw new Error('Fling frame times did not increase');
    steps.push((direction * (after.offset - before.offset)) / (after.t - before.t));
    if (index >= first + 2)
      paces.push({ ...pace(frames, index, direction), consecutive: !missed(index) && !missed(index - 1) && !missed(index - 2) });
  }
  const distance = direction * (frames.at(-1)!.offset - release.offset);
  const velocity = Math.abs(release.velocity);
  const endSpeed = paces.findLast((one) => one.speed > 0)?.speed ?? 0;
  return { distance, velocity, ratio: distance / velocity, steps, paces, cadence: frameCadence, endSpeed };
}

export function calibrate(controls: readonly ScrollRecording[]): Calibration {
  if (controls.length < 5) throw new Error('A fling calibration needs at least five fully measured controls');
  const measured = controls.map((control) => motion(control));
  return {
    count: measured.length,
    minRatio: Math.min(...measured.map((one) => one.ratio)),
    maxRatio: Math.max(...measured.map((one) => one.ratio)),
    endSpeed: Math.max(...measured.map((one) => one.endSpeed)),
  };
}

function moving(frames: readonly Sample[], time: number, direction: number): boolean {
  const index = frames.findLastIndex((frame) => frame.t <= time);
  if (index < 2) return true;
  const before = pace(frames, index, direction);
  return before.speed * (before.span - cadence(frames)) >= missedPixels;
}

export function momentum(recording: ScrollRecording, control: Calibration, writes: readonly MomentumWrite[] = []): MomentumVerdict {
  const release = recording.release;
  if (release === null || release.velocity === null) throw new Error('A fling has no measured release velocity');
  const after = recording.frames.filter((frame) => frame.t > release.t);
  const last = after.at(-1)?.t ?? release.t;
  const during = writes.filter((write) => write.time > release.t && write.time <= last && write.to !== write.from);
  const measured = motion(recording, during[0]?.time);
  const direction = Math.sign(release.velocity);
  let interruptions = 0;
  let unjudged = 0;
  let reversals = 0;
  for (const step of measured.steps) if (step < 0) reversals += 1;
  for (let index = 1; index < measured.paces.length; index += 1) {
    const current = measured.paces[index]!;
    const previous = measured.paces[index - 1]!;
    if (!current.consecutive || !previous.consecutive) unjudged += 1;
    else if (current.speed <= 0 && previous.speed * (current.span - measured.cadence) >= missedPixels) interruptions += 1;
  }
  const stoppingWrites = during.filter((write) => moving(after, write.time, direction)).length;
  const floor = floorShare * control.minRatio;
  return { ratio: measured.ratio, floor, reversals, interruptions, unjudged, stoppingWrites, aboveFloor: measured.ratio >= floor };
}
