import type { Recording, ScrollWrite, WheelRun } from './recording';

type WheelRange = { min: number; max: number };
type WheelReference = {
  run: WheelRun;
  through: number;
  deltas: Map<number, number>;
  late: Map<number, WheelRange>;
  early: Map<number, WheelRange>;
  expected: number;
  observed: number;
  uncertainty: WheelRange;
};
type Wheels = { ordered: WheelReference[]; problems: WheelIssue[]; late: CausalWheel[] };
type WheelLimits = { delta: number; minimum: number; maximum: number };
export type WheelPosition = { active: WheelReference | undefined; reference: WheelRun | undefined };
type PageInterval = { kind: 'frame-interval'; from: number; to: number };

export type WheelJudgement = 'full' | 'causal-late';
export type WheelIssue = {
  frame: number;
  reason: 'invalid-wheel' | 'wheel-scrolls-missing' | 'wheel-frame-missing' | 'wheel-unit' | 'overlapping-wheels';
};
type WheelTiming = {
  frame: number;
  stamp: number;
  received: number;
  lag: number;
  refresh: number;
  task: PageInterval;
  scroll: number | null;
  writes: number;
};
export type CausalWheel = WheelTiming & ({ kind: 'wheel-late' } | { kind: 'wheel-after-write'; write: ScrollWrite; gap: number });

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

function shiftRange(changes: Map<number, WheelRange>, frame: number, delta: number, direction: number): void {
  const range = changes.get(frame) ?? { min: 0, max: 0 };
  range.min += direction * Math.min(0, delta);
  range.max += direction * Math.max(0, delta);
  changes.set(frame, range);
}

function settlingEnds(scrollEnds: readonly number[], writes: readonly ScrollWrite[]): number[] {
  const moved = writes.filter((write) => write.to !== write.from).map((write) => write.time);
  let previous = Number.NEGATIVE_INFINITY;
  return [...scrollEnds]
    .sort((a, b) => a - b)
    .filter((end) => {
      const answers = moved.some((time) => time >= previous && time < end);
      previous = end;
      return !answers;
    });
}

export function wheelLimits(wheel: WheelReference, frame: number, change: number): WheelLimits | undefined {
  const late = wheel.late.get(frame);
  const early = wheel.early.get(frame);
  const lateOnly = late !== undefined && !wheel.deltas.has(frame) && early === undefined && wheel.expected === 0 && wheel.observed === 0;
  const previous = wheel.observed;
  wheel.expected += wheel.deltas.get(frame) ?? 0;
  wheel.observed += change;
  wheel.uncertainty.min += late?.min ?? 0;
  wheel.uncertainty.max += late?.max ?? 0;
  const limits = {
    delta: wheel.expected - previous,
    minimum: wheel.expected + (early?.min ?? 0) + wheel.uncertainty.min - previous,
    maximum: wheel.expected + (early?.max ?? 0) + wheel.uncertainty.max - previous,
  };
  if (early === undefined) {
    wheel.expected = 0;
    wheel.observed = 0;
    wheel.uncertainty = { min: 0, max: 0 };
  }
  return lateOnly ? undefined : limits;
}

export function wheelsOf(recording: Recording, judgement: WheelJudgement): Wheels {
  const ordered: WheelReference[] = [];
  const problems: WheelIssue[] = [];
  const lateWheels: CausalWheel[] = [];
  const frameTimes = recording.frames.map((frame) => frame.time);
  const ownWrites = [...(recording.writes ?? [])].sort((a, b) => a.time - b.time);
  const writes = ownWrites.map((write) => write.time);
  const nativeScrolls = [...(recording.scrolls ?? [])].sort((a, b) => a.stamp - b.stamp);
  const scrolls = nativeScrolls.map((scroll) => scroll.stamp);
  const ends = settlingEnds(recording.scrollEnds ?? [], ownWrites);
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
    const changes = new Map<number, WheelRange>();
    let through = run.toFrame;
    for (const step of run.steps) {
      const lag = step.received - step.stamp;
      const delta = -step.deltaY;
      const prior = ownWrites[lowerBound(writes, step.stamp, true) - 1];
      const gap = prior === undefined ? Infinity : step.stamp - prior.time;
      const afterWrite = gap <= refresh ? prior : undefined;
      let uncertainFrame = step.frame;
      let uncertainDelta = delta;
      if (judgement === 'full' || lag <= refresh) {
        const first = judgement === 'full' ? step.frame : Math.max(run.fromFrame + 1, lowerBound(frameTimes, step.stamp));
        const settled = ends[lowerBound(ends, step.stamp)];
        const delivered = judgement === 'full' ? step.frame : Math.max(first, lowerBound(frameTimes, step.received, true));
        const deadline = settled === undefined ? delivered : Math.max(delivered, lowerBound(frameTimes, settled));
        if (deadline >= frameTimes.length) problems.push({ frame: step.frame, reason: 'wheel-frame-missing' });
        const last = Math.min(deadline, frameTimes.length - 1);
        deltas.set(last, (deltas.get(last) ?? 0) + delta);
        shiftRange(changes, first, delta, 1);
        shiftRange(changes, last, delta, -1);
        through = Math.max(through, last);
        if (judgement === 'full' || afterWrite === undefined) continue;
        uncertainFrame = last;
        uncertainDelta = -delta;
      }
      if (recording.scrolls === undefined) problems.push({ frame: step.frame, reason: 'wheel-scrolls-missing' });
      shiftRange(late, uncertainFrame, uncertainDelta, 1);
      let scrollIndex = lowerBound(scrolls, step.stamp);
      if (afterWrite !== undefined && nativeScrolls[scrollIndex]?.top === afterWrite.to) scrollIndex += 1;
      const scroll = scrolls[scrollIndex] ?? null;
      const until = scroll ?? recording.frames.at(-1)!.sampled;
      const timing: WheelTiming = {
        frame: step.frame,
        stamp: step.stamp,
        received: step.received,
        lag,
        refresh,
        task: { kind: 'frame-interval', from: recording.frames[step.frame - 1]!.time, to: recording.frames[step.frame]!.time },
        scroll,
        writes: Math.max(0, lowerBound(writes, until, true) - lowerBound(writes, step.received)),
      };
      lateWheels.push(
        afterWrite === undefined ? { ...timing, kind: 'wheel-late' } : { ...timing, kind: 'wheel-after-write', write: afterWrite, gap },
      );
    }
    const early = new Map<number, WheelRange>();
    let minimum = 0;
    let maximum = 0;
    for (let frame = run.fromFrame + 1; frame <= through; frame += 1) {
      minimum += changes.get(frame)?.min ?? 0;
      maximum += changes.get(frame)?.max ?? 0;
      if (minimum !== 0 || maximum !== 0) early.set(frame, { min: minimum, max: maximum });
    }
    ordered.push({ run, through, deltas, late, early, expected: 0, observed: 0, uncertainty: { min: 0, max: 0 } });
  }
  ordered.sort((a, b) => a.run.fromFrame - b.run.fromFrame);
  let end = -1;
  let overlap = false;
  for (const wheel of ordered) {
    if (wheel.run.fromFrame < end) {
      problems.push({ frame: wheel.run.fromFrame + 1, reason: 'overlapping-wheels' });
      overlap = true;
    }
    end = Math.max(end, wheel.through);
  }
  return { ordered: overlap ? [] : ordered, problems, late: lateWheels };
}

export function wheelReader(ordered: readonly WheelReference[]): (frame: number) => WheelPosition {
  let cursor = 0;
  let previous: WheelReference | undefined;
  return (frame) => {
    while (cursor < ordered.length && frame > ordered[cursor]!.through) previous = ordered[cursor++];
    const next = ordered[cursor];
    const active = next !== undefined && frame > next.run.fromFrame ? next : undefined;
    return { active, reference: active?.run ?? previous?.run };
  };
}
