import { expect } from 'bun:test';
import { ios, type IOSSession, type IOSTest, type Point, type ScrollRecording } from '@runlith/e2e/ios';
import { stand } from '@runlith/e2e/stand';
import { Schema } from 'effect';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlEnvelope, displacement, type ControlEnvelope } from './displacement';
import { evidence } from './evidence';
import { calibrate, momentum, motion, type Calibration } from './momentum.fixture';
import type { StandPort } from './port';
import type { MeasuredControl, Recording, Rect, Targets } from './recording';
import { MeasuredControl as MeasuredControlSchema, Recording as RecordingSchema, Targets as TargetsSchema } from './recording.fixture';

const served = stand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)));
const scroller = '[data-scrollable][role="group"]';
const paging = Schema.Struct({ requested: Schema.Number, landed: Schema.Number, latency: Schema.Number });
const Landing = Schema.Struct({ requested: Schema.Number, landed: Schema.Number, loaded: Schema.Boolean });
const unavailable = {
  finger:
    'The lane has not established a constant CSS touch speed from the native swipe duration; its absolute finger speed/distance budget remains unproved',
  rail: 'The phone-width feed hides its message rail; native rail selection and gold have sampled coverage only when Recorder observes visible rail targets',
};

type Capture = { recording: Recording; scroll: ScrollRecording };
type Controls = { envelope: ControlEnvelope; calibration: Calibration };
type Fling = { concurrent?: () => Promise<void>; navigation?: boolean; momentum?: boolean; duration?: number };

function call<A, Input>(
  phone: IOSSession,
  work: (port: StandPort, input: Input) => A | Promise<A>,
  schema: Schema.Decoder<A>,
  input: Input,
): Promise<A> {
  return phone.evaluate(`(${work.toString()})(window.feedStand, ${JSON.stringify(input)})`, schema);
}
const act = <Input = undefined>(
  phone: IOSSession,
  work: (port: StandPort, input: Input) => void | Promise<void>,
  input?: Input,
): Promise<void> => phone.evaluate(`(${work.toString()})(window.feedStand, ${JSON.stringify(input)})`, Schema.Void);
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
  const x = viewport.left + viewport.width * 0.6;
  const from = await phone.pagePoint({ x, y: viewport.top + viewport.height * 0.25 });
  const to = await phone.pagePoint({ x, y: viewport.top + viewport.height * 0.75 });
  await start(phone, name);
  await frames(phone);
  const capture = await phone.recording(scroller);
  const concurrent = options.concurrent?.();
  await Promise.all([phone.swipe({ from, to, duration: options.duration ?? 0.2, delta: 5 }), concurrent]);
  const scroll = await capture.result;
  await frames(phone);
  const recording = await stop(phone);
  const result = { recording, scroll };
  await save(phone, name, result);
  expect(scroll.touches.some((touch) => touch.type === 'touchstart' && touch.trusted)).toBe(true);
  expect(scroll.touches.some((touch) => touch.type === 'touchend' && touch.trusted)).toBe(true);
  expect(scroll.release).not.toBeNull();
  if (!options.navigation && options.momentum !== false) {
    expect(scroll.release!.velocity).toBeLessThan(0);
    expect(motion(scroll).distance).toBeGreaterThan(0);
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
    const verdict = momentum(capture.scroll, calibration);
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

async function pageUnderFinger(phone: IOSTest, envelope: ControlEnvelope): Promise<void> {
  await open(phone, 120);
  await act(phone, (port) => port.pageLatency(20));
  let landing: typeof Landing.Type | undefined;
  const capture = await fling(phone, 'drag-page-landing', {
    duration: 2,
    momentum: false,
    concurrent: async () => {
      landing = await call(
        phone,
        async (port) => {
          await port.pressed();
          await port.frames(6);
          const requested = performance.now();
          const loaded = await port.loadOlder();
          return { requested, landed: performance.now(), loaded };
        },
        Landing,
        undefined,
      );
    },
  });
  const pageState = await call(phone, (port) => port.paging(), paging, undefined);
  await save(phone, 'drag-page-landing-timing', { landing, paging: pageState });
  expect(landing?.loaded).toBe(true);
  expect(pageState.requested).toBe(1);
  expect(pageState.landed).toBe(1);
  const pressed = capture.scroll.touches.find((touch) => touch.type === 'touchstart' && touch.trusted)!;
  expect(landing!.requested).toBeGreaterThan(pressed.t);
  expect(landing!.landed).toBeLessThan(capture.scroll.release!.t);
  expect(capture.recording.frames.some((frame) => frame.touching && frame.time >= landing!.landed)).toBe(true);
  assertGeometry(capture.recording, envelope);
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
  const before = capture.scroll.frames.findLast((frame) => frame.t < selected);
  const previous = capture.scroll.frames.findLast((frame) => before !== undefined && frame.t < before.t);
  if (before === undefined || previous === undefined) throw new Error('No native momentum frames preceded the rail tap');
  expect(Math.abs((before.offset - previous.offset) / (before.t - previous.t))).toBeGreaterThan(controls.calibration.endSpeed);
  expect(evidence(capture.recording).railFrames).toBeGreaterThan(0);
  assertCommand(capture.recording, 'rail');
  assertGeometry(capture.recording, controls.envelope);
}

async function disclosures(phone: IOSTest, envelope: ControlEnvelope): Promise<void> {
  for (const side of ['above', 'at', 'below'] as const) {
    await act(phone, (port, side) => port.positionDisclosure(side), side);
    await start(phone, `disclosure-${side}`);
    await frames(phone);
    await tap(phone, (await targets(phone)).disclosure);
    await frames(phone, 20);
    await tap(phone, (await targets(phone)).disclosure);
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

function assertMomentum(capture: Capture, controls: Controls): void {
  const verdict = momentum(capture.scroll, controls.calibration);
  console.log(JSON.stringify({ scenario: capture.recording.name, momentum: verdict }));
  expect(verdict.reversals).toBe(0);
  expect(verdict.interruptions).toBe(0);
  expect(verdict.withinSpread).toBe(true);
  assertGeometry(capture.recording, controls.envelope);
}

ios(
  'native feed: measured controls, unmeasured history and a page during momentum',
  async (phone) => {
    await save(phone, 'coverage', { runtime: phone.runtime, udid: phone.udid, timing: phone.timing, unavailable });
    const measured = await controls(phone);
    await open(phone);
    const tail = await quiet(phone, 'open-tail', (port) => port.remount(), measured.envelope);
    expect(tail.frames.at(-1)?.anchor?.kind).toBe('following');
    const history = await fling(phone, 'unmeasured-history');
    const began = history.scroll.touches.find((touch) => touch.type === 'touchstart' && touch.trusted)!.t;
    expect(history.recording.frames.some((frame) => frame.time > began && frame.unmeasured > 0)).toBe(true);
    const unpaged = await call(phone, (port) => port.paging(), paging, undefined);
    expect(unpaged.requested).toBe(0);
    expect(unpaged.landed).toBe(0);
    assertMomentum(history, measured);
    const paused = await quiet(phone, 'streaming-paused', (port) => port.stream(24), measured.envelope);
    expect(paused.frames.every((frame) => frame.anchor?.kind === 'paused')).toBe(true);
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

    await open(phone, 120);
    await act(phone, (port) => port.pageLatency(20));
    let landing: typeof Landing.Type | undefined;
    const paged = await fling(phone, 'page-mid-fling', {
      concurrent: async () => {
        await releasedMotion(phone);
        landing = await call(
          phone,
          async (port) => {
            const requested = performance.now();
            const loaded = await port.loadOlder();
            return { requested, landed: performance.now(), loaded };
          },
          Landing,
          undefined,
        );
      },
    });
    const pageState = await call(phone, (port) => port.paging(), paging, undefined);
    await save(phone, 'page-landing', { landing, paging: pageState });
    expect(landing?.loaded).toBe(true);
    expect(pageState.requested).toBe(1);
    expect(pageState.landed).toBe(1);
    expect(landing!.requested).toBeGreaterThan(paged.scroll.release!.t);
    const at = paged.scroll.frames.findIndex((frame) => frame.t >= landing!.landed);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(paged.scroll.frames.length - 1);
    const before = paged.scroll.frames[at - 1]!;
    const after = paged.scroll.frames[at]!;
    const direction = Math.sign(paged.scroll.release!.velocity!);
    expect((direction * (after.offset - before.offset)) / (after.t - before.t)).toBeGreaterThan(measured.calibration.endSpeed);
    assertMomentum(paged, measured);
    await pageUnderFinger(phone, measured.envelope);
    await rail(phone, measured);
    await latest(phone, measured.envelope);
    await act(phone, async (port) => {
      const state = port.state();
      await port.position(Math.max(0, state.height - state.viewport * 4));
    });
    await disclosures(phone, measured.envelope);
    await keyboard(phone, measured.envelope);
  },
  { runtimes: ['26', '27'] },
);
