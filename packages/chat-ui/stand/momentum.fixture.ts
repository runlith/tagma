import type { ScrollRecording } from '@runlith/e2e/ios';

export type Motion = {
  distance: number;
  velocity: number;
  ratio: number;
  speeds: number[];
  endSpeed: number;
};
export type Calibration = { count: number; minRatio: number; maxRatio: number; endSpeed: number };
export type MomentumVerdict = {
  ratio: number;
  minRatio: number;
  maxRatio: number;
  reversals: number;
  interruptions: number;
  withinSpread: boolean;
};

export function motion(recording: ScrollRecording): Motion {
  const release = recording.release;
  if (release === null || release.velocity === null || release.velocity === 0) throw new Error('A fling has no measured release velocity');
  const ended = recording.touches.find((touch) => touch.type === 'touchend' && touch.trusted);
  if (ended === undefined || ended.t !== release.t) throw new Error('A fling has no matching first trusted touchend');
  const direction = Math.sign(release.velocity);
  const frames = recording.frames.filter((frame) => frame.t > release.t);
  const first = frames.findIndex((frame) => frame.offset !== release.offset);
  if (first < 0) throw new Error('A fling never moved after release');
  const speeds: number[] = [];
  for (let index = first + 1; index < frames.length; index += 1) {
    const before = frames[index - 1]!;
    const after = frames[index]!;
    if (after.t <= before.t) throw new Error('Fling frame times did not increase');
    speeds.push((direction * (after.offset - before.offset)) / (after.t - before.t));
  }
  const distance = direction * (frames.at(-1)!.offset - release.offset);
  const velocity = Math.abs(release.velocity);
  return { distance, velocity, ratio: distance / velocity, speeds, endSpeed: speeds.findLast((speed) => speed > 0) ?? 0 };
}

export function calibrate(controls: readonly ScrollRecording[]): Calibration {
  if (controls.length < 5) throw new Error('A fling calibration needs at least five fully measured controls');
  const measured = controls.map(motion);
  return {
    count: measured.length,
    minRatio: Math.min(...measured.map((one) => one.ratio)),
    maxRatio: Math.max(...measured.map((one) => one.ratio)),
    endSpeed: Math.max(...measured.map((one) => one.endSpeed)),
  };
}

export function momentum(recording: ScrollRecording, control: Calibration): MomentumVerdict {
  const measured = motion(recording);
  let interruptions = 0;
  let reversals = 0;
  for (let index = 0; index < measured.speeds.length; index += 1) {
    const speed = measured.speeds[index]!;
    if (speed < 0) reversals += 1;
    if (speed <= 0 && (measured.speeds[index - 1] ?? 0) > control.endSpeed) interruptions += 1;
  }
  return {
    ratio: measured.ratio,
    minRatio: control.minRatio,
    maxRatio: control.maxRatio,
    reversals,
    interruptions,
    withinSpread: measured.ratio >= control.minRatio && measured.ratio <= control.maxRatio,
  };
}
