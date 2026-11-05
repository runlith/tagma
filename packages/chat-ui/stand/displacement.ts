import { anchorFlow, type AnchorFlow, type AnchorIssue } from './anchor';
import { causes, type CauseEvidence } from './causes';
import type { Drag, Frame, Navigation, Recording, Rect, Sentinel } from './recording';
import { wheelLimits, wheelReader, wheelsOf, type CausalWheel, type WheelIssue, type WheelJudgement, type WheelPosition } from './wheel';

const TOLERANCE = 0.5;
const REQUIRED_CONTROLS = 5;

type Reading = { sentinel: Sentinel; delta: number };
type Pair = { evidence: PairEvidence; readings: Reading[]; moving: boolean; touching: boolean };
type PairProblem = { frame: number; reason: 'invalid-time' | 'invalid-geometry' | 'invalid-dpr' | 'dpr-changed' };
type Segment = { index: number; command: Drag };
type SegmentPosition = { active: Segment | undefined; reference: Drag | undefined };
type Segments = { ordered: Segment[]; problems: UncheckedPair[] };
type DragStep = { pair: PairEvidence; pixel: number };
type SegmentTracks = { evidence: DragEvidence; tracks: Map<number, number>; structural: DragStep[] };

export type PairEvidence = {
  frame: number;
  dt: number;
  pixel: number;
  mode: 'quiet' | 'scroll' | 'finger' | 'drag' | 'momentum' | 'command' | 'wheel';
  comparisons: number;
  excluded: number;
  changedRows: string[];
  scrollDelta: number;
  commonDelta: number | null;
  wheelDelta: number | null;
  change: number | null;
  limit: number | null;
  controls: number;
  anchorIdentity: string | null;
  anchorShift: number | null;
};

export type DisplacementFailure = {
  kind:
    | 'quiet'
    | 'cumulative'
    | 'anchor'
    | 'anchor-cumulative'
    | 'scroll'
    | 'common'
    | 'drag-step'
    | 'drag-reversal'
    | 'drag-distance'
    | 'drag-chain'
    | 'momentum'
    | 'wheel'
    | 'wheel-write';
  frame: number;
  sentinel: number | null;
  pixels: number;
  limit: number;
};

export type UncheckedPair =
  | {
      frame: number;
      reason:
        | 'invalid-time'
        | 'invalid-geometry'
        | 'invalid-dpr'
        | 'dpr-changed'
        | 'no-common-sentinel'
        | 'invalid-drag'
        | 'overlapping-drags'
        | 'overlapping-inputs'
        | 'invalid-command'
        | 'command-not-landed'
        | 'no-known-drag'
        | 'no-full-drag-anchor'
        | 'no-drag-rate'
        | 'no-previous-momentum'
        | 'insufficient-controls';
    }
  | AnchorIssue
  | WheelIssue;

export type DragAnchor = { sentinel: number; distance: number; error: number };
export type DragEvidence = {
  command: Drag;
  comparedPairs: number;
  commonDistance: number;
  observedRate: number | null;
  ratePairs: number;
  anchors: DragAnchor[];
  complete: boolean;
};

export type DragChain = {
  fromSegment: number;
  toSegment: number;
  commandedDistance: number;
  minimum: number | null;
  maximum: number | null;
  error: number | null;
  complete: boolean;
};

export type DisplacementEvidence = {
  frames: number;
  drags: DragEvidence[];
  chains: DragChain[];
  pairs: PairEvidence[];
  comparisons: number;
  anchorComparisons: number;
  causes: CauseEvidence;
  lateWheels: CausalWheel[];
  maxError: number;
  cumulativeDrift: number;
  failures: DisplacementFailure[];
  unchecked: UncheckedPair[];
};

export type ControlChange = { frame: number; previousDelta: number; delta: number; change: number };

export type ControlCurve = { name: string; direction: number; samples: ControlChange[] };
export type DiscardedControl = { name: string; frame: number; reason: string };
export type ControlEnvelope = {
  status: 'ready' | 'insufficient';
  controls: number;
  discarded: DiscardedControl[];
  curves: ControlCurve[];
  maximumChange: number;
};

function visible(rect: Rect, viewport: Rect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom &&
    rect.right > viewport.left &&
    rect.left < viewport.right
  );
}

function finite(rect: Rect): boolean {
  return Object.values(rect).every(Number.isFinite);
}

function devicePixel(frame: Frame): number | undefined {
  return Number.isFinite(frame.dpr) && frame.dpr > 0 ? 1 / frame.dpr : undefined;
}

function validDrag(drag: Drag, frames: number): boolean {
  return (
    Number.isFinite(drag.distance) &&
    Number.isFinite(drag.speed) &&
    (drag.speed > 0 || (drag.speed === 0 && drag.distance === 0)) &&
    Number.isInteger(drag.fromFrame) &&
    Number.isInteger(drag.toFrame) &&
    drag.fromFrame >= 0 &&
    drag.toFrame > drag.fromFrame &&
    drag.toFrame < frames &&
    typeof drag.preventFling === 'boolean'
  );
}

function segmentsOf(recording: Recording): Segments {
  const ordered: Segment[] = [];
  const problems: UncheckedPair[] = [];
  for (const [index, command] of recording.drags.entries()) {
    if (!validDrag(command, recording.frames.length)) problems.push({ frame: 0, reason: 'invalid-drag' });
    else ordered.push({ index, command });
  }
  ordered.sort((a, b) => a.command.fromFrame - b.command.fromFrame);
  let end = -1;
  let overlap = false;
  for (const segment of ordered) {
    if (segment.command.fromFrame < end) {
      problems.push({ frame: segment.command.fromFrame + 1, reason: 'overlapping-drags' });
      overlap = true;
    }
    end = Math.max(end, segment.command.toFrame);
  }
  return { ordered: overlap ? [] : ordered, problems };
}

function segmentReader(ordered: readonly Segment[]): (frame: number) => SegmentPosition {
  let cursor = 0;
  let previous: Segment | undefined;
  return (frame) => {
    while (cursor < ordered.length && frame > ordered[cursor]!.command.toFrame) previous = ordered[cursor++];
    const next = ordered[cursor];
    const active = next !== undefined && frame > next.command.fromFrame ? next : undefined;
    return { active, reference: active?.command ?? previous?.command };
  };
}

function validNavigation(command: Navigation, frames: number): boolean {
  return (
    Number.isInteger(command.fromFrame) &&
    command.fromFrame >= 0 &&
    command.fromFrame <= frames &&
    Number.isFinite(command.timeStamp) &&
    Number.isFinite(command.received) &&
    (command.toFrame === null || (Number.isInteger(command.toFrame) && command.toFrame >= command.fromFrame && command.toFrame < frames))
  );
}

function pairOf(previous: Frame, current: Frame, index: number, drag?: Drag, wheel?: WheelPosition): Pair | PairProblem {
  const dt = current.time - previous.time;
  if (!Number.isFinite(dt) || dt <= 0) return { frame: index, reason: 'invalid-time' };
  const pixel = devicePixel(current);
  if (pixel === undefined || devicePixel(previous) === undefined) return { frame: index, reason: 'invalid-dpr' };
  if (previous.dpr !== current.dpr) return { frame: index, reason: 'dpr-changed' };
  if (
    !Number.isFinite(previous.scrollTop) ||
    !Number.isFinite(current.scrollTop) ||
    !finite(previous.viewport) ||
    !finite(current.viewport)
  ) {
    return { frame: index, reason: 'invalid-geometry' };
  }
  const beforeRows = new Map(previous.rows.map((row) => [row.key, row]));
  const afterRows = new Map(current.rows.map((row) => [row.key, row]));
  const changed = new Set<string>();
  for (const [key, row] of afterRows) {
    const old = beforeRows.get(key);
    const before = old?.rect;
    const rect = row.rect;
    if (!finite(rect) || (before !== undefined && !finite(before))) return { frame: index, reason: 'invalid-geometry' };
    if (
      before !== undefined &&
      (before.width !== rect.width || before.height !== rect.height || old!.signature.text !== row.signature.text)
    ) {
      changed.add(key);
    }
  }
  const before = new Map(previous.sentinels.map((sentinel) => [sentinel.id, sentinel]));
  const readings: Reading[] = [];
  let excluded = 0;
  let smallest = Infinity;
  let largest = -Infinity;
  for (const sentinel of current.sentinels) {
    const held = before.get(sentinel.id);
    if (held === undefined) continue;
    if (!finite(held.rect) || !finite(sentinel.rect)) return { frame: index, reason: 'invalid-geometry' };
    if (!visible(held.rect, previous.viewport) || !visible(sentinel.rect, current.viewport)) continue;
    const oldRow = beforeRows.get(sentinel.row)?.rect;
    const row = afterRows.get(sentinel.row)?.rect;
    if (held.row !== sentinel.row || held.text !== sentinel.text || oldRow === undefined || row === undefined) {
      excluded += 1;
      continue;
    }
    if (changed.has(sentinel.row)) {
      const inset = sentinel.rect.top - row.top;
      const oldInset = held.rect.top - oldRow.top;
      const precision =
        Number.EPSILON * Math.max(1, Math.abs(row.top), Math.abs(oldRow.top), Math.abs(sentinel.rect.top), Math.abs(held.rect.top)) * 16;
      if (held.rect.width !== sentinel.rect.width || held.rect.height !== sentinel.rect.height || Math.abs(inset - oldInset) > precision) {
        excluded += 1;
        continue;
      }
    }
    const delta = sentinel.rect.top - held.rect.top;
    readings.push({ sentinel, delta });
    smallest = Math.min(smallest, delta);
    largest = Math.max(largest, delta);
  }
  const active = drag !== undefined && index > drag.fromFrame && index <= drag.toFrame;
  const dragging = active && drag.preventFling;
  const stationary = dragging && drag.distance === 0 && drag.speed === 0;
  const wheelActive = wheel?.active !== undefined;
  const reference = wheel?.reference;
  const afterWheel = reference !== undefined && !wheelActive && (drag === undefined || drag.fromFrame <= reference.toFrame);
  const still = previous.finger === current.finger && previous.scrollTop === current.scrollTop;
  const touching = wheelActive ? false : drag === undefined ? (previous.touching || current.touching) && !still : dragging;
  const moving =
    wheelActive ||
    (drag?.preventFling === true && index > drag.toFrame
      ? false
      : (afterWheel ? current.moving : previous.moving || current.moving) || touching || active);
  const commonDelta = readings.length === 0 ? null : (smallest + largest) / 2;
  return {
    moving,
    touching,
    readings,
    evidence: {
      frame: index,
      dt,
      pixel,
      mode: wheelActive
        ? 'wheel'
        : stationary
          ? 'quiet'
          : dragging
            ? 'drag'
            : !moving
              ? 'quiet'
              : !current.structure
                ? 'scroll'
                : touching
                  ? 'finger'
                  : 'momentum',
      comparisons: readings.length,
      excluded,
      changedRows: [...changed],
      scrollDelta: current.scrollTop - previous.scrollTop,
      commonDelta,
      wheelDelta: null,
      change: null,
      limit: null,
      controls: 0,
      anchorIdentity: null,
      anchorShift: null,
    },
  };
}

function exceeds(value: number, limit: number): boolean {
  return value - limit > Number.EPSILON * Math.max(1, value, limit) * 16;
}

function changeOf(previous: Pair, current: Pair): ControlChange {
  const previousDelta = previous.evidence.commonDelta!;
  const delta = current.evidence.commonDelta!;
  return { frame: current.evidence.frame, previousDelta, delta, change: Math.abs(delta - previousDelta) };
}

function curveOf(recording: Recording): ControlCurve | DiscardedControl {
  const rejected = (frame: number, reason: string): DiscardedControl => ({ name: recording.name, frame, reason });
  if (recording.frames.length < 3) return rejected(0, 'insufficient-frames');
  if ((recording.commands?.length ?? 0) > 0) return rejected(0, 'navigation-command');
  if (recording.wheels.length > 0) return rejected(0, 'discrete-wheel-control');
  const segments = segmentsOf(recording);
  const problem = segments.problems[0];
  if (problem !== undefined) return rejected(problem.frame, problem.reason);
  const segmentAt = segmentReader(segments.ordered);
  for (const [index, frame] of recording.frames.entries()) {
    if (frame.sizeChanges !== 0) return rejected(index, 'size-change');
    if (frame.unmeasured !== 0) return rejected(index, 'unmeasured-row');
    if (frame.structure) return rejected(index, 'structural-change');
  }
  const samples: ControlChange[] = [];
  let previous: Pair | undefined;
  let direction = 0;
  for (let index = 1; index < recording.frames.length; index += 1) {
    const pair = pairOf(recording.frames[index - 1]!, recording.frames[index]!, index, segmentAt(index).reference);
    if ('reason' in pair) return rejected(index, pair.reason);
    const measured = pair.evidence;
    if (measured.changedRows.length > 0) return rejected(index, 'changed-row');
    if (pair.readings.length === 0) return rejected(index, 'no-common-sentinel');
    for (const reading of pair.readings) {
      if (exceeds(Math.abs(reading.delta - measured.commonDelta!), TOLERANCE)) return rejected(index, 'control-rigidity');
      if (exceeds(Math.abs(reading.delta + measured.scrollDelta), measured.pixel)) return rejected(index, 'control-drift');
    }
    if (!pair.moving || pair.touching) {
      previous = undefined;
      continue;
    }
    const delta = measured.commonDelta!;
    if (delta !== 0) {
      if (direction !== 0 && Math.sign(delta) !== direction) return rejected(index, 'reversed-motion');
      direction = Math.sign(delta);
    }
    if (previous !== undefined) samples.push(changeOf(previous, pair));
    previous = pair;
  }
  if (samples.length === 0 || direction === 0) return rejected(0, 'no-momentum-samples');
  return { name: recording.name, direction, samples };
}

export function controlEnvelope(recordings: readonly Recording[]): ControlEnvelope {
  const curves: ControlCurve[] = [];
  const discarded: DiscardedControl[] = [];
  for (const recording of recordings) {
    const curve = curveOf(recording);
    if ('reason' in curve) discarded.push(curve);
    else curves.push(curve);
  }
  let maximumChange = 0;
  for (const curve of curves) for (const sample of curve.samples) maximumChange = Math.max(maximumChange, sample.change);
  return {
    status: curves.length >= REQUIRED_CONTROLS ? 'ready' : 'insufficient',
    controls: curves.length,
    discarded,
    curves,
    maximumChange,
  };
}

export function displacement(
  recording: Recording,
  control?: ControlEnvelope,
  wheelJudgement: WheelJudgement = 'full',
): DisplacementEvidence {
  const segments = segmentsOf(recording);
  const segmentAt = segmentReader(segments.ordered);
  const wheels = wheelsOf(recording, wheelJudgement);
  const wheelAt = wheelReader(wheels.ordered);
  const tracked: SegmentTracks[] = recording.drags.map((command) => ({
    evidence: { command, comparedPairs: 0, commonDistance: 0, observedRate: null, ratePairs: 0, anchors: [], complete: false },
    tracks: new Map<number, number>(),
    structural: [],
  }));
  const result: DisplacementEvidence = {
    frames: recording.frames.length,
    pairs: [],
    comparisons: 0,
    anchorComparisons: 0,
    causes: causes(recording),
    lateWheels: wheels.late,
    maxError: 0,
    cumulativeDrift: 0,
    failures: [],
    unchecked: [...segments.problems, ...wheels.problems],
    drags: tracked.map((segment) => segment.evidence),
    chains: [],
  };
  const navigation: Navigation[] = [];
  for (const one of recording.commands ?? []) {
    if (!validNavigation(one, recording.frames.length)) result.unchecked.push({ frame: 0, reason: 'invalid-command' });
    else if (one.toFrame === null) result.unchecked.push({ frame: one.fromFrame, reason: 'command-not-landed' });
    else navigation.push(one);
  }
  navigation.sort((a, b) => a.fromFrame - b.fromFrame);
  let commandCursor = 0;
  let commandEnd = -1;
  let cumulative = new Map<number, number>();
  let anchorIdentity: string | undefined;
  let anchorSum = 0;
  let previousMomentum: Pair | undefined;
  const fail = (frame: number, kind: DisplacementFailure['kind'], pixels: number, limit: number, sentinel: number | null = null) => {
    result.maxError = Math.max(result.maxError, pixels);
    if (exceeds(pixels, limit)) result.failures.push({ kind, frame, sentinel, pixels, limit });
  };
  if (recording.frames.length < 2) result.unchecked.push({ frame: 0, reason: 'no-common-sentinel' });
  for (const late of wheels.late) fail(late.frame, 'wheel-write', late.writes, 0);
  for (let index = 1; index < recording.frames.length; index += 1) {
    const before = recording.frames[index - 1]!;
    const after = recording.frames[index]!;
    while (commandCursor < navigation.length && navigation[commandCursor]!.fromFrame <= index) {
      commandEnd = Math.max(commandEnd, navigation[commandCursor++]!.toFrame!);
    }
    const navigating = index <= commandEnd;
    const position = segmentAt(index);
    const wheelPosition = wheelAt(index);
    if (position.active !== undefined && wheelPosition.active !== undefined) {
      result.unchecked.push({ frame: index, reason: 'overlapping-inputs' });
      previousMomentum = undefined;
      continue;
    }
    const wheel = navigating ? undefined : wheelPosition.active;
    const segment = navigating ? undefined : position.active;
    const active = segment === undefined ? undefined : tracked[segment.index];
    const drag = segment?.command;
    const tracking = drag !== undefined;
    const dragging = drag?.preventFling === true;
    const pair = pairOf(before, after, index, position.reference, wheelPosition);
    if ('reason' in pair) {
      result.unchecked.push(pair);
      cumulative.clear();
      anchorIdentity = undefined;
      anchorSum = 0;
      active?.tracks.clear();
      previousMomentum = undefined;
      continue;
    }
    const measured = pair.evidence;
    if (navigating) measured.mode = 'command';
    result.pairs.push(measured);
    result.comparisons += measured.comparisons;
    const quiet = measured.mode === 'quiet';
    let flow: AnchorFlow | undefined;
    if (quiet) {
      const observed = anchorFlow(before, after, index);
      if ('reason' in observed) {
        result.unchecked.push(observed);
        anchorIdentity = undefined;
        anchorSum = 0;
        cumulative.clear();
      } else {
        flow = observed;
        if (anchorIdentity !== flow.identity) {
          anchorSum = 0;
          cumulative.clear();
        }
        anchorIdentity = flow.identity;
        anchorSum += flow.shift;
        measured.anchorIdentity = flow.identity;
        measured.anchorShift = flow.shift;
        result.anchorComparisons += 1;
        result.cumulativeDrift = Math.max(result.cumulativeDrift, Math.abs(anchorSum));
        fail(index, 'anchor', Math.abs(flow.shift), TOLERANCE);
        fail(index, 'anchor-cumulative', Math.abs(anchorSum), TOLERANCE);
      }
    } else {
      anchorIdentity = undefined;
      anchorSum = 0;
    }
    if (measured.commonDelta === null && !quiet) {
      if (!navigating) result.unchecked.push({ frame: index, reason: 'no-common-sentinel' });
      cumulative.clear();
      anchorIdentity = undefined;
      anchorSum = 0;
      active?.tracks.clear();
      previousMomentum = undefined;
      continue;
    }
    const nextCumulative = new Map<number, number>();
    const nextTracks = new Map<number, number>();
    if (tracking) {
      active!.evidence.comparedPairs += 1;
      const distance = quiet ? flow?.shift : measured.commonDelta;
      if (distance !== undefined && distance !== null) active!.evidence.commonDistance += distance;
    }
    const wheelRange = wheel === undefined ? undefined : wheelLimits(wheel, index, measured.commonDelta!);
    if (wheelRange !== undefined) {
      measured.wheelDelta = wheelRange.delta;
      measured.change = measured.commonDelta!;
      measured.limit = measured.pixel;
      fail(index, 'wheel', Math.max(0, wheelRange.minimum - measured.change, measured.change - wheelRange.maximum), measured.pixel);
    }
    if (dragging && !quiet) measured.change = Math.abs(measured.commonDelta!);
    let validRate = true;
    const flowProblems = new Set<string>();
    for (const reading of pair.readings) {
      const id = reading.sentinel.id;
      let residual: number | undefined;
      if (!quiet) {
        const error = Math.abs(reading.delta - measured.commonDelta!);
        fail(index, 'common', error, TOLERANCE, id);
        if (exceeds(error, TOLERANCE)) validRate = false;
      }
      if (quiet) {
        if (flow !== undefined) {
          const expected = flow.expected(reading.sentinel.row);
          if ('reason' in expected) {
            const key = `${expected.row}:${expected.reason}`;
            if (!flowProblems.has(key)) result.unchecked.push(expected);
            flowProblems.add(key);
          } else {
            residual = reading.delta - expected.pixels;
            fail(index, 'quiet', Math.abs(residual), TOLERANCE, id);
          }
        }
      } else if (measured.mode === 'scroll' || (dragging && !after.structure)) {
        const error = Math.abs(reading.delta + measured.scrollDelta);
        fail(index, 'scroll', error, measured.pixel, id);
        if (exceeds(error, measured.pixel)) validRate = false;
      }
      if (residual !== undefined) {
        const sum = (cumulative.get(id) ?? 0) + residual;
        nextCumulative.set(id, sum);
        result.cumulativeDrift = Math.max(result.cumulativeDrift, Math.abs(sum));
        fail(index, 'cumulative', Math.abs(sum), TOLERANCE, id);
      }
      if (tracking) {
        const held = index === drag!.fromFrame + 1 ? 0 : active!.tracks.get(id);
        const distance = quiet ? residual : reading.delta;
        if (held !== undefined && distance !== undefined) nextTracks.set(id, held + distance);
      }
    }
    if (dragging && active !== undefined && !quiet) {
      if (drag!.distance > 0) fail(index, 'drag-reversal', Math.max(0, -measured.commonDelta!), measured.pixel);
      if (after.structure) active.structural.push({ pair: measured, pixel: measured.pixel });
      else if (validRate) {
        const rate = Math.abs(measured.commonDelta!) / measured.dt;
        active.evidence.observedRate = Math.max(active.evidence.observedRate ?? 0, rate);
        active.evidence.ratePairs += 1;
      }
    }
    cumulative = nextCumulative;
    if (active !== undefined) active.tracks = nextTracks;
    if (pair.touching && !dragging && !navigating) result.unchecked.push({ frame: index, reason: 'no-known-drag' });
    if (measured.mode === 'momentum') {
      if (previousMomentum === undefined) result.unchecked.push({ frame: index, reason: 'no-previous-momentum' });
      else if (control?.status !== 'ready') result.unchecked.push({ frame: index, reason: 'insufficient-controls' });
      else {
        measured.controls = control.controls;
        measured.change = changeOf(previousMomentum, pair).change;
        measured.limit = control.maximumChange;
        fail(index, 'momentum', measured.change, measured.limit);
      }
    }
    previousMomentum = !navigating && !quiet && measured.mode !== 'wheel' && pair.moving && !pair.touching ? pair : undefined;
  }
  let previousSegment: Segment | undefined;
  let chain: DragChain | undefined;
  let chainQuantum = 0;
  for (const segment of segments.ordered) {
    const drag = segment.command;
    const held = tracked[segment.index]!;
    const evidence = held.evidence;
    const covered = evidence.comparedPairs === drag.toFrame - drag.fromFrame;
    if (!drag.preventFling) {
      evidence.complete = covered;
      chain = undefined;
      previousSegment = segment;
      continue;
    }
    const pixel = devicePixel(recording.frames[drag.toFrame]!);
    if (pixel === undefined) continue;
    for (const step of held.structural) {
      const rate = evidence.observedRate;
      if (rate === null) result.unchecked.push({ frame: step.pair.frame, reason: 'no-drag-rate' });
      else {
        const quantum = drag.quantum ?? 0;
        step.pair.limit = rate * step.pair.dt + step.pixel + quantum;
        fail(step.pair.frame, 'drag-step', Math.max(0, Math.abs(step.pair.commonDelta!) - rate * step.pair.dt), step.pixel + quantum);
      }
    }
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const [sentinel, distance] of held.tracks) {
      const error = Math.abs(distance - drag.distance);
      evidence.anchors.push({ sentinel, distance, error });
      minimum = Math.min(minimum, distance);
      maximum = Math.max(maximum, distance);
      if (covered) fail(drag.toFrame, 'drag-distance', error, pixel + (drag.quantum ?? 0), sentinel);
    }
    evidence.complete = covered && held.tracks.size > 0;
    if (covered && held.tracks.size === 0) result.unchecked.push({ frame: drag.toFrame, reason: 'no-full-drag-anchor' });
    if (chain === undefined || previousSegment?.command.toFrame !== drag.fromFrame) {
      chain = {
        fromSegment: segment.index,
        toSegment: segment.index,
        commandedDistance: 0,
        minimum: 0,
        maximum: 0,
        error: 0,
        complete: true,
      };
      result.chains.push(chain);
      chainQuantum = 0;
    }
    chainQuantum = Math.max(chainQuantum, drag.quantum ?? 0);
    chain.toSegment = segment.index;
    chain.commandedDistance += drag.distance;
    chain.complete = chain.complete && evidence.complete;
    if (chain.complete) {
      chain.minimum = chain.minimum! + minimum;
      chain.maximum = chain.maximum! + maximum;
      const error = Math.max(Math.abs(chain.minimum - chain.commandedDistance), Math.abs(chain.maximum - chain.commandedDistance));
      chain.error = Math.max(chain.error!, error);
      fail(drag.toFrame, 'drag-chain', error, pixel + chainQuantum);
    } else {
      chain.minimum = null;
      chain.maximum = null;
      chain.error = null;
    }
    previousSegment = segment;
  }
  return result;
}
