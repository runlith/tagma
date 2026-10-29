import type { Recording, WheelRun } from './recording';

type WheelRange = { min: number; max: number };
type WheelReference = { run: WheelRun; deltas: Map<number, number>; late: Map<number, WheelRange> };
type Wheels = { ordered: WheelReference[]; problems: WheelIssue[]; late: LateWheel[] };
type WheelPosition = { active: WheelReference | undefined; reference: WheelRun | undefined };
type PageInterval = { kind: 'frame-interval'; from: number; to: number };

export type WheelJudgement = 'full' | 'causal-late';
export type WheelIssue = {
  frame: number;
  reason: 'invalid-wheel' | 'wheel-scrolls-missing' | 'wheel-unit' | 'overlapping-wheels';
};
export type LateWheel = {
  kind: 'wheel-late';
  frame: number;
  stamp: number;
  received: number;
  lag: number;
  refresh: number;
  task: PageInterval;
  scroll: number | null;
  writes: number;
};

function lowerBound(times: readonly number[], time: number, inclusive = false): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle]! < time || (inclusive && times[middle] === time)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function wheelsOf(recording: Recording, judgement: WheelJudgement): Wheels {
  const ordered: WheelReference[] = [];
  const problems: WheelIssue[] = [];
  const lateWheels: LateWheel[] = [];
  const writes = (recording.writes ?? []).map((write) => write.time).sort((a, b) => a - b);
  const scrolls = (recording.scrolls ?? []).map((scroll) => scroll.stamp).sort((a, b) => a - b);
  const ticks = recording.ticks?.length ? recording.ticks : recording.frames.map((frame) => frame.time);
  const intervals = ticks
    .slice(1)
    .map((time, index) => time - ticks[index]!)
    .filter((time) => time > 0)
    .sort((a, b) => a - b);
  const refresh = intervals[Math.floor(intervals.length / 2)] ?? Infinity;
  for (const run of recording.wheels) {
    const range =
      Number.isInteger(run.fromFrame) &&
      Number.isInteger(run.toFrame) &&
      run.fromFrame >= 0 &&
      run.toFrame > run.fromFrame &&
      run.toFrame < recording.frames.length;
    if (
      !range ||
      run.steps.length === 0 ||
      run.steps.some(
        (step) =>
          !Number.isInteger(step.frame) ||
          step.frame <= run.fromFrame ||
          step.frame > run.toFrame ||
          !Number.isFinite(step.deltaY) ||
          !Number.isFinite(step.received - step.stamp),
      )
    ) {
      problems.push({ frame: 0, reason: 'invalid-wheel' });
      continue;
    }
    if (run.steps.some((step) => step.deltaMode !== 0)) {
      problems.push({ frame: run.fromFrame + 1, reason: 'wheel-unit' });
      continue;
    }
    const deltas = new Map<number, number>();
    const late = new Map<number, WheelRange>();
    for (const step of run.steps) {
      const lag = step.received - step.stamp;
      const delta = -step.deltaY;
      if (judgement === 'full' || lag <= refresh) {
        deltas.set(step.frame, (deltas.get(step.frame) ?? 0) + delta);
        continue;
      }
      if (recording.scrolls === undefined) problems.push({ frame: step.frame, reason: 'wheel-scrolls-missing' });
      const range = late.get(step.frame) ?? { min: 0, max: 0 };
      range.min += Math.min(0, delta);
      range.max += Math.max(0, delta);
      late.set(step.frame, range);
      const scroll = scrolls[lowerBound(scrolls, step.stamp)] ?? null;
      const until = scroll ?? recording.frames.at(-1)!.sampled;
      lateWheels.push({
        kind: 'wheel-late',
        frame: step.frame,
        stamp: step.stamp,
        received: step.received,
        lag,
        refresh,
        task: { kind: 'frame-interval', from: recording.frames[step.frame - 1]!.time, to: recording.frames[step.frame]!.time },
        scroll,
        writes: Math.max(0, lowerBound(writes, until, true) - lowerBound(writes, step.received)),
      });
    }
    ordered.push({ run, deltas, late });
  }
  ordered.sort((a, b) => a.run.fromFrame - b.run.fromFrame);
  let end = -1;
  let overlap = false;
  for (const wheel of ordered) {
    if (wheel.run.fromFrame < end) {
      problems.push({ frame: wheel.run.fromFrame + 1, reason: 'overlapping-wheels' });
      overlap = true;
    }
    end = Math.max(end, wheel.run.toFrame);
  }
  return { ordered: overlap ? [] : ordered, problems, late: lateWheels };
}

export function wheelReader(ordered: readonly WheelReference[]): (frame: number) => WheelPosition {
  let cursor = 0;
  let previous: WheelReference | undefined;
  return (frame) => {
    while (cursor < ordered.length && frame > ordered[cursor]!.run.toFrame) previous = ordered[cursor++];
    const next = ordered[cursor];
    const active = next !== undefined && frame > next.run.fromFrame ? next : undefined;
    return { active, reference: active?.run ?? previous?.run };
  };
}
