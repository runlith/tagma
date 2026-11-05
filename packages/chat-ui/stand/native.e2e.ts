import { expect } from 'bun:test';
import { ios, type IOSSession, type IOSTest, type Point, type ScrollRecording } from '@runlith/e2e/ios';
import { stand } from '@runlith/e2e/stand';
import { Schema } from 'effect';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlEnvelope, displacement, type ControlEnvelope } from './displacement';
import { evidence } from './evidence';
import { calibrate, momentum, motion, pace, type Calibration } from './momentum.fixture';
import type { StandPort } from './port';
import type { MeasuredControl, Recording, Rect, ScrollWrite, Targets } from './recording';
import { MeasuredControl as MeasuredControlSchema, Recording as RecordingSchema, Targets as TargetsSchema } from './recording.fixture';
import { act, call } from './standPage';

const served = stand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)));
const scroller = '[data-scrollable][role="group"]';
const PointSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const paging = Schema.Struct({ requested: Schema.Number, landed: Schema.Number, latency: Schema.Number });
const Landing = Schema.Struct({ requested: Schema.Number, landed: Schema.Number, loaded: Schema.Boolean });
const unavailable = {
  finger:
    'The lane has not established a constant CSS touch speed from the native swipe duration; its absolute finger speed/distance budget remains unproved',
  rail: 'The phone-width feed hides its message rail; native rail selection and gold have sampled coverage only when Recorder observes visible rail targets',
};

type Capture = { recording: Recording; scroll: ScrollRecording };
type Controls = { envelope: ControlEnvelope; calibration: Calibration };
type Swipe = { start: number; end: number; duration: number };
type Fling = { concurrent?: () => Promise<void>; navigation?: boolean; swipe?: Swipe };
const control: Swipe = { start: 0.25, end: 0.75, duration: 0.2 };
const calibrated = new Map<string, Controls>();
const approaches = new Map<string, number>();
const runtimes = { runtimes: ['26', '27'] };
const long: Swipe = { start: 0.1, end: 0.9, duration: 0.1 };

const frames = (phone: IOSSession, count = 2): Promise<void> => act(phone, (port, count) => port.frames(count), count);
const start = (phone: IOSSession, name: string): Promise<void> => act(phone, (port, name) => port.start(name), name);
const stop = (phone: IOSSession): Promise<Recording> => call(phone, (port) => port.stop(), RecordingSchema, undefined);
const targets = (phone: IOSSession): Promise<Targets> => call(phone, (port) => port.targets(), TargetsSchema, undefined);
const center = (rect: Rect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const tap = async (phone: IOSSession, rect: Rect | null): Promise<void> => {
  if (rect === null) throw new Error('The requested native control has no visible DOM rectangle');
  await phone.tap(await phone.pagePoint(center(rect)));
};
const save = (phone: IOSTest, name: string, value: unknown): Promise<void> =>
  writeFile(join(phone.artifacts, `${name}.json`), JSON.stringify(value));

async function open(phone: IOSSession, loaded = 10000): Promise<void> {
  await phone.open(served.url(`?loaded=${loaded}&touch=1`));
  await phone.evaluate(
    `new Promise((resolve, reject) => {
    const ready = () => {
      const failed = document.querySelector('[data-failure]');
      if (failed) { reject(new Error(failed.dataset.failure)); return; }
      if (window.feedStand?.ready && document.querySelector('[data-timeline-key]')) resolve();
      else requestAnimationFrame(ready);
    };
    ready();
  })`,
    Schema.Void,
  );
}

function assertGeometry(recording: Recording, envelope?: ControlEnvelope): void {
  const result = evidence(recording);
  const movement = displacement(recording, envelope);
  console.log(
    JSON.stringify({
      scenario: recording.name,
      result,
      displacement: {
        failures: movement.failures.length,
        unchecked: movement.unchecked.length,
        firstFailures: movement.failures.slice(0, 3),
        firstUnchecked: movement.unchecked.slice(0, 3),
      },
      unavailable,
    }),
  );
  expect(result.frames).toBeGreaterThan(2);
  expect(result.comparisons).toBeGreaterThan(0);
  expect(result.maxBlank).toBe(0);
  expect(result.boxComparisons).toBeGreaterThan(0);
  expect(result.unknownBoxes).toBe(0);
  expect(result.maxBoxError).toBeLessThanOrEqual(0.5);
  expect(result.unknownRail).toBe(0);
  expect(result.railMismatches).toBe(0);
  expect(movement.comparisons).toBeGreaterThan(0);
  expect(movement.failures).toEqual([]);
  expect(movement.unchecked).toEqual([]);
  expect(movement.causes.failures).toEqual([]);
  expect(movement.causes.unchecked).toEqual([]);
}

async function fling(phone: IOSTest, name: string, options: Fling = {}): Promise<Capture> {
  const { viewport } = await targets(phone);
  const swipe = options.swipe ?? control;
  const x = viewport.left + viewport.width * 0.6;
  const from = await phone.pagePoint({ x, y: viewport.top + viewport.height * swipe.start });
  const to = await phone.pagePoint({ x, y: viewport.top + viewport.height * swipe.end });
  await start(phone, name);
  await frames(phone);
  const capture = await phone.recording(scroller);
  const distance = viewport.height * (swipe.end - swipe.start);
  await act(phone, (port, { distance, speed }) => port.beginDrag(distance, speed, false), { distance, speed: distance / swipe.duration });
  const concurrent = options.concurrent?.();
  await Promise.all([phone.swipe({ from, to, duration: swipe.duration, delta: 5 }), concurrent]);
  const scroll = await capture.result;
  await act(phone, (port) => port.endDrag());
  await frames(phone);
  const recording = await stop(phone);
  const result = { recording, scroll };
  await save(phone, name, result);
  expect(scroll.touches.some((touch) => touch.type === 'touchstart' && touch.trusted)).toBe(true);
  expect(scroll.touches.some((touch) => touch.type === 'touchend' && touch.trusted)).toBe(true);
  expect(scroll.release).not.toBeNull();
  if (!options.navigation) {
    expect(scroll.release!.velocity).toBeLessThan(0);
    expect(motion(scroll, momentumWrites(result)[0]?.time).distance).toBeGreaterThan(0);
  }
  return result;
}

function controlProblem(capture: Capture, warmed: MeasuredControl): string | null {
  if (capture.recording.frames.some((frame) => frame.sizeChanges !== 0)) return 'A measured control changed row size';
  if (capture.recording.frames.some((frame) => frame.unmeasured !== 0)) return 'A measured control mounted an unmeasured row';
  if (capture.recording.frames.some((frame) => frame.structure)) return 'A measured control changed structure';
  if (capture.recording.frames.some((frame) => frame.scrollTop < warmed.from || frame.scrollTop > warmed.to))
    return 'A control left its DOM-measured region';
  return null;
}

async function controls(phone: IOSTest): Promise<Controls> {
  await open(phone);
  const before = await call(phone, (port) => port.paging(), paging, undefined);
  expect(before.requested).toBe(0);
  expect(before.landed).toBe(0);
  const warmed = await call(phone, (port) => port.warm(12000), MeasuredControlSchema, undefined);
  expect(warmed.rows).toBeGreaterThan(0);
  expect(warmed.start).toBeGreaterThan(warmed.from);
  const captures: Capture[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (let index = 0; index < 5; index += 1) {
    await act(phone, (port, top) => port.position(top), warmed.start);
    const capture = await fling(phone, `control-${index + 1}`);
    const problem = controlProblem(capture, warmed);
    if (problem === null) captures.push(capture);
    else rejected.push({ name: capture.recording.name, reason: problem });
  }
  const after = await call(phone, (port) => port.paging(), paging, undefined);
  await save(phone, 'control-cleanliness', { warmed, accepted: captures.length, rejected, before, after });
  expect(after.requested).toBe(0);
  expect(after.landed).toBe(0);
  if (captures.length < 5) throw new Error(`Native calibration requires five clean measured controls: ${JSON.stringify(rejected)}`);
  const envelope = controlEnvelope(captures.map((capture) => capture.recording));
  const calibration = calibrate(captures.map((capture) => capture.scroll));
  await save(phone, 'control-envelope', { envelope, calibration });
  expect(envelope.status).toBe('ready');
  expect(envelope.controls).toBeGreaterThanOrEqual(5);
  expect(envelope.discarded).toEqual([]);
  for (const capture of captures) {
    const verdict = momentum(capture.scroll, calibration, capture.recording.writes);
    expect(momentumWrites(capture)).toEqual([]);
    expect(verdict.reversals).toBe(0);
    expect(verdict.interruptions).toBe(0);
    assertGeometry(capture.recording, envelope);
  }
  return { envelope, calibration };
}

async function quiet<Input = undefined>(
  phone: IOSTest,
  name: string,
  action: (port: StandPort, input: Input) => void | Promise<void>,
  envelope: ControlEnvelope,
  input?: Input,
): Promise<Recording> {
  await start(phone, name);
  await frames(phone);
  await act(phone, action, input);
  await frames(phone, 16);
  const recording = await stop(phone);
  await save(phone, name, { recording, evidence: evidence(recording), movement: displacement(recording, envelope) });
  assertGeometry(recording, envelope);
  return recording;
}

async function releasedMotion(phone: IOSSession): Promise<void> {
  await act(phone, async (port) => {
    await port.released();
    const top = port.state().top;
    do {
      await port.frames();
    } while (port.state().top === top);
    await port.frames(3);
  });
}

function assertCommand(recording: Recording, kind: 'latest' | 'rail'): void {
  const command = recording.commands?.find((one) => one.kind === kind);
  if (command === undefined || command.toFrame === null) throw new Error(`The native ${kind} command did not land`);
  expect(command.toFrame - command.fromFrame).toBeLessThanOrEqual(2);
}

async function latest(phone: IOSTest, envelope: ControlEnvelope): Promise<void> {
  const hit = (await targets(phone)).latest;
  await start(phone, 'latest');
  await frames(phone);
  await tap(phone, hit);
  await frames(phone, 40);
  const recording = await stop(phone);
  await save(phone, 'latest', { recording, evidence: evidence(recording), movement: displacement(recording, envelope) });
  assertCommand(recording, 'latest');
  expect(recording.frames.at(-1)?.anchor?.kind).toBe('following');
  assertGeometry(recording, envelope);
}

async function rail(phone: IOSTest, controls: Controls): Promise<void> {
  const hits = (await targets(phone)).rail;
  if (hits.length === 0) {
    await save(phone, 'rail-coverage', { sampled: false, reason: unavailable.rail });
    return;
  }
  const chosen = hits[Math.min(4, hits.length - 1)]!;
  let selected = 0;
  const capture = await fling(phone, 'rail-during-fling', {
    navigation: true,
    concurrent: async () => {
      await releasedMotion(phone);
      const point = await phone.pagePoint(center(chosen.rect));
      selected = await phone.evaluate('performance.now()', Schema.Number);
      await phone.tap(point);
    },
  });
  await save(phone, 'rail-coverage', { sampled: true, target: chosen.target, selected });
  const command = capture.recording.commands?.find((one) => one.kind === 'rail');
  if (command === undefined) throw new Error('The native rail tap did not reach a message tile');
  expect(command.target).toBe(chosen.target);
  const before = capture.scroll.frames.findLastIndex((frame) => frame.t < selected);
  if (before < 2) throw new Error('No native momentum frames preceded the rail tap');
  expect(Math.abs(pace(capture.scroll.frames, before, 1).speed)).toBeGreaterThan(controls.calibration.endSpeed);
  expect(evidence(capture.recording).railFrames).toBeGreaterThan(0);
  assertCommand(capture.recording, 'rail');
  assertGeometry(capture.recording, controls.envelope);
}

async function disclosures(phone: IOSTest, envelope: ControlEnvelope): Promise<void> {
  for (const side of ['above', 'at', 'below'] as const) {
    await act(phone, (port, side) => port.positionDisclosure(side), side);
    await start(phone, `disclosure-${side}`);
    await frames(phone);
    const point = () => call(phone, (port) => port.disclosurePoint(), PointSchema, undefined);
    await phone.tap(await phone.pagePoint(await point()));
    await frames(phone, 20);
    await phone.tap(await phone.pagePoint(await point()));
    await frames(phone, 20);
    const recording = await stop(phone);
    await save(phone, recording.name, { recording, evidence: evidence(recording), movement: displacement(recording, envelope) });
    expect(recording.frames.some((frame) => frame.controlExpanded === 'true')).toBe(true);
    expect(recording.frames.at(-1)?.controlExpanded).toBe('false');
    if (side === 'at') {
      const first = recording.frames[0]?.control;
      if (first === undefined || first === null) throw new Error('The disclosure had no baseline DOM control rectangle');
      for (const frame of recording.frames) {
        expect(frame.control).not.toBeNull();
        expect(Math.abs(frame.control!.top - first.top)).toBeLessThanOrEqual(0.5);
      }
    }
    assertGeometry(recording, envelope);
  }
}

async function keyboard(phone: IOSTest, envelope: ControlEnvelope): Promise<void> {
  const before = await targets(phone);
  if (before.visual === null) throw new Error('MobileSafari exposed no visual viewport for the native keyboard scenario');
  await start(phone, 'keyboard');
  await frames(phone);
  await tap(phone, before.composer);
  const after = await call(
    phone,
    async (port, height) => {
      while ((port.targets().visual?.height ?? height) >= height) await port.frames();
      await port.frames(20);
      return port.targets();
    },
    TargetsSchema,
    before.visual.height,
  );
  const recording = await stop(phone);
  await save(phone, 'keyboard', { before, after, recording, evidence: evidence(recording), movement: displacement(recording, envelope) });
  expect(after.scale).toBe(before.scale);
  expect(after.visual!.height).toBeLessThan(before.visual.height);
  expect(after.host.height).toBeLessThan(before.host.height);
  expect(recording.frames.at(-1)!.viewport.height).toBeLessThan(recording.frames[0]!.viewport.height);
  assertGeometry(recording, envelope);
}

function momentumWrites(capture: Capture): ScrollWrite[] {
  const release = capture.scroll.release;
  const last = capture.scroll.frames.at(-1);
  if (release === null || last === undefined) throw new Error('A fling has no release or momentum frames');
  return (capture.recording.writes ?? []).filter((write) => write.time > release.t && write.time <= last.t && write.to !== write.from);
}

function measuredOf(phone: IOSTest): Controls {
  const measured = calibrated.get(phone.runtime);
  if (measured === undefined) throw new Error('The measured controls of this runtime did not complete; this scenario has no envelope');
  return measured;
}

function approachOf(phone: IOSTest): number {
  const approach = approaches.get(phone.runtime);
  if (approach === undefined) throw new Error('No unmeasured-history fling of this runtime measured the approach distance');
  return approach;
}

const away = (phone: IOSSession) =>
  act(phone, async (port) => {
    const state = port.state();
    await port.position(Math.max(0, state.height - state.viewport * 4));
  });

async function pageFling(phone: IOSTest, controls: Controls, name: string, approach: number, swipe: Swipe): Promise<Capture> {
  await open(phone, 120);
  await act(phone, (port) => port.pageLatency(20));
  await act(phone, (port, distance) => port.approach(distance), approach);
  let landing: typeof Landing.Type | undefined;
  const paged = await fling(phone, name, {
    swipe,
    concurrent: async () => {
      await releasedMotion(phone);
      landing = await call(
        phone,
        async (port) => {
          const loaded = await port.loadOlder();
          const { requestedAt, landedAt } = port.paging();
          const origin = performance.timeOrigin;
          return { requested: (requestedAt ?? Number.NaN) - origin, landed: (landedAt ?? Number.NaN) - origin, loaded };
        },
        Landing,
        undefined,
      );
    },
  });
  const pageState = await call(phone, (port) => port.paging(), paging, undefined);
  const release = paged.scroll.release!;
  const runway = paged.scroll.frames.filter((frame) => frame.t > release.t && frame.t < (momentumWrites(paged)[0]?.time ?? Infinity));
  const top = Math.min(...runway.map((frame) => frame.offset));
  await save(phone, `${name}-landing`, { landing, paging: pageState, top, swipe });
  expect(landing?.loaded).toBe(true);
  expect(pageState.requested).toBe(1);
  expect(pageState.landed).toBe(1);
  const at = paged.scroll.frames.findIndex((frame) => frame.t >= landing!.landed);
  expect(at).toBeGreaterThan(1);
  expect(at).toBeLessThan(paged.scroll.frames.length - 1);
  if (swipe === control) {
    expect(landing!.landed).toBeGreaterThan(release.t);
    expect(pace(paged.scroll.frames, at, Math.sign(release.velocity!)).speed).toBeGreaterThan(controls.calibration.endSpeed);
  } else expect(landing!.landed).toBeLessThan(runway.at(-1)!.t);
  if (top <= 0)
    throw new Error(
      `${name}: momentum stopped at the top of the old content with the older page already arrived; evidence: ${name}.json, ${name}-landing.json`,
    );
  return paged;
}

function assertMomentum(capture: Capture, controls: Controls): void {
  const writes = momentumWrites(capture);
  const verdict = momentum(capture.scroll, controls.calibration, writes);
  console.log(JSON.stringify({ scenario: capture.recording.name, momentum: verdict, writes }));
  expect(verdict.stoppingWrites).toBe(0);
  expect(verdict.reversals).toBe(0);
  expect(verdict.interruptions).toBe(0);
  expect(verdict.aboveFloor).toBe(true);
  assertGeometry(capture.recording, controls.envelope);
}

ios(
  'native feed: measured controls',
  async (phone) => {
    await save(phone, 'coverage', { runtime: phone.runtime, udid: phone.udid, timing: phone.timing, unavailable });
    calibrated.set(phone.runtime, await controls(phone));
  },
  runtimes,
);

ios(
  'native feed: open-tail',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    const tail = await quiet(phone, 'open-tail', (port) => port.remount(), measured.envelope);
    expect(tail.frames.at(-1)?.anchor?.kind).toBe('following');
  },
  runtimes,
);

ios(
  'native feed: unmeasured-history',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    const history = await fling(phone, 'unmeasured-history');
    approaches.set(phone.runtime, motion(history.scroll, momentumWrites(history)[0]?.time).distance / 2);
    const began = history.scroll.touches.find((touch) => touch.type === 'touchstart' && touch.trusted)!.t;
    expect(history.recording.frames.some((frame) => frame.time > began && frame.unmeasured > 0)).toBe(true);
    const unpaged = await call(phone, (port) => port.paging(), paging, undefined);
    expect(unpaged.requested).toBe(0);
    expect(unpaged.landed).toBe(0);
    assertMomentum(history, measured);
  },
  runtimes,
);

ios(
  'native feed: streaming-paused',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    await away(phone);
    const paused = await quiet(phone, 'streaming-paused', (port) => port.stream(24), measured.envelope);
    expect(paused.frames.every((frame) => frame.anchor?.kind === 'paused')).toBe(true);
  },
  runtimes,
);

ios(
  'native feed: width',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    const original = await targets(phone);
    await quiet(
      phone,
      'width',
      async (port, host) => {
        await port.resize(host.width * 0.8, host.height);
        await port.frames(20);
        await port.resize(host.width, host.height);
        await port.frames(20);
      },
      measured.envelope,
      original.host,
    );
  },
  runtimes,
);

ios(
  'native feed: page-mid-fling',
  async (phone) => {
    const measured = measuredOf(phone);
    assertMomentum(await pageFling(phone, measured, 'page-mid-fling', approachOf(phone), control), measured);
  },
  runtimes,
);

ios(
  'native feed: page-long-fling',
  async (phone) => {
    await pageFling(phone, measuredOf(phone), 'page-long-fling', approachOf(phone), long);
  },
  runtimes,
);

ios(
  'native feed: rail',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    await away(phone);
    await rail(phone, measured);
  },
  runtimes,
);

ios(
  'native feed: latest',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    await away(phone);
    await latest(phone, measured.envelope);
  },
  runtimes,
);

ios(
  'native feed: disclosures',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    await away(phone);
    await disclosures(phone, measured.envelope);
  },
  runtimes,
);

ios(
  'native feed: keyboard',
  async (phone) => {
    const measured = measuredOf(phone);
    await open(phone);
    await away(phone);
    await keyboard(phone, measured.envelope);
  },
  runtimes,
);
