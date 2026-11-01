import { afterAll, beforeAll } from 'bun:test';
import { createRemoteDebugger, type RemoteDebugger } from 'appium-remote-debugger';
import { it } from '@runlith/effect-test';
import { Data, Deferred, Effect, Schema, type Scope } from 'effect';
import { join } from 'node:path';
import { onFailure, recorded } from '../artifacts.ts';
import { errorScript, flushErrors, pageFailure, PageException, PageFailed } from '../pageErrors.ts';
import { bootstrap } from './inspector.ts';
import { makeTouch, type Touch } from '../touch.ts';
import { holdLane, prepareSimulator, simulator } from './simulator.ts';

export type Point = { readonly x: number; readonly y: number };
export type Swipe = { readonly from: Point; readonly to: Point; readonly duration?: number; readonly delta?: number };
export type SimulatorOptions = { readonly runtime: string; readonly deviceType?: string };
export type SimulatorTiming = { readonly clone: number; readonly boot: number };

export class IOSUnavailable extends Data.TaggedError('IOSUnavailable')<{ readonly message: string; readonly cause?: unknown }> {}
export class UntransferableValue extends Data.TaggedError('UntransferableValue')<{ readonly message: string }> {}
export type IOSRun = { readonly runtimes?: readonly string[]; readonly deviceType?: string };

export const ScrollFrame = Schema.Struct({ t: Schema.Number, offset: Schema.Number });
export type ScrollFrame = typeof ScrollFrame.Type;
export const TouchSample = Schema.Struct({
  type: Schema.Literals(['touchstart', 'touchmove', 'touchend', 'touchcancel']),
  t: Schema.Number,
  offset: Schema.Number,
  x: Schema.NullOr(Schema.Number),
  y: Schema.NullOr(Schema.Number),
  trusted: Schema.Boolean,
});
export type TouchSample = typeof TouchSample.Type;
export const ScrollSample = Schema.Struct({ t: Schema.Number, offset: Schema.Number, trusted: Schema.Boolean });
export type ScrollSample = typeof ScrollSample.Type;
export const Release = Schema.Struct({
  t: Schema.Number,
  offset: Schema.Number,
  velocity: Schema.NullOr(Schema.Number),
  touchVelocity: Schema.NullOr(Schema.Number),
  velocitySource: Schema.Literal('first-momentum-frames'),
});
export type Release = typeof Release.Type;
export const ScrollRecording = Schema.Struct({
  frames: Schema.Array(ScrollFrame),
  touches: Schema.Array(TouchSample),
  scrolls: Schema.Array(ScrollSample),
  release: Schema.NullOr(Release),
});
export type ScrollRecording = typeof ScrollRecording.Type;
export type ScrollCapture = { readonly result: Promise<ScrollRecording> };
export type IOSSession = {
  readonly udid: string;
  readonly deviceSet: string;
  readonly runtime: string;
  readonly timing: SimulatorTiming;
  readonly open: (url: string) => Promise<void>;
  readonly evaluate: <A>(expression: string, schema: Schema.Decoder<A>) => Promise<A>;
  readonly swipe: (gesture: Swipe) => Promise<void>;
  readonly tap: (point: Point) => Promise<void>;
  readonly touch: Touch;
  readonly pagePoint: (point: Point) => Promise<Point>;
  readonly screenshot: (path: string) => Promise<void>;
  readonly recording: (selector: string) => Promise<ScrollCapture>;
};
export type IOSTest = IOSSession & { readonly artifacts: string };

const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new IOSUnavailable({ message, cause }) });
const decode = <A>(schema: Schema.Decoder<A>, value: unknown): A => Schema.decodeUnknownSync(schema)(value);

const startRecording = String.raw`function(input) {
  const element = document.querySelector(input.selector);
  if (element === null) throw new Error('scroller not found: ' + input.selector);
  const frames = [], touches = [], scrolls = [];
  window.__runlithIOSRecording = {frames, touches, scrolls};
  let released = null, canceled = false, active = false, steady = 0, previous = element.scrollTop;
  const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
  const touch = (event) => {
    const point = event.touches[0] ?? event.changedTouches[0];
    const sample = { type: event.type, t: performance.now(), offset: element.scrollTop, x: point?.clientX ?? null, y: point?.clientY ?? null, trusted: event.isTrusted };
    touches.push(sample);
    if (event.type === 'touchstart') active = true;
    if (event.isTrusted && released === null && event.type === 'touchend') released = { t: sample.t, offset: sample.offset };
    if (event.isTrusted && event.type === 'touchcancel') canceled = true;
    steady = 0;
  };
  const scroll = (event) => scrolls.push({t: performance.now(), offset: element.scrollTop, trusted: event.isTrusted});
  for (const type of types) element.addEventListener(type, touch, { passive: true });
  element.addEventListener('scroll', scroll, { passive: true });
  const frame = (t) => {
    if (active) frames.push({ t, offset: element.scrollTop });
    steady = element.scrollTop === previous ? steady + 1 : 0;
    previous = element.scrollTop;
    if (active && (released !== null || canceled) && steady >= 45) {
      for (const type of types) element.removeEventListener(type, touch);
      element.removeEventListener('scroll', scroll);
      const momentum = frames.filter((one, i) => released !== null && one.t >= released.t && one.offset !== released.offset && (i === 0 || one.offset !== frames[i - 1].offset)).slice(0, 3);
      const first = momentum[0], last = momentum.at(-1);
      const velocity = first && last && last.t > first.t ? (last.offset - first.offset) / (last.t - first.t) : null;
      const moves = touches.filter((one) => one.type === 'touchmove' && one.y !== null && (released === null || one.t <= released.t));
      const lastTouch = moves.at(-1), before = lastTouch && moves.findLast((one) => one.t < lastTouch.t);
      const touchVelocity = lastTouch && before ? -(lastTouch.y - before.y) / (lastTouch.t - before.t) : null;
      const result = { frames, touches, scrolls, release: released === null ? null : { ...released, velocity, touchVelocity, velocitySource: 'first-momentum-frames' } };
      window.__runlithIOSRecording = result;
      void fetch(input.endpoint, { method: 'POST', body: JSON.stringify(result) });
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return true;
}`;
const transfer = String.raw`(value) => {
  class Refused { constructor(reason) { this.reason = reason; } }
  const refuse = (path, what) => { throw new Refused(what + ' at ' + path); };
  const field = (holder, key, path) => {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor === undefined) refuse(path, 'an array hole');
    if (!('value' in descriptor)) refuse(path, 'an accessor property');
    if (!descriptor.enumerable) refuse(path, 'a non-enumerable property');
    return descriptor.value;
  };
  const copy = (raw, path, open) => {
    switch (typeof raw) {
      case 'number':
        if (!Number.isFinite(raw) || Object.is(raw, -0)) refuse(path, Object.is(raw, -0) ? '-0' : String(raw));
        return raw;
      case 'string':
      case 'boolean':
        return raw;
      case 'object': {
        if (raw === null) return raw;
        if (open.includes(raw)) refuse(path, 'a cycle');
        const prototype = Object.getPrototypeOf(raw);
        const keys = Reflect.ownKeys(raw);
        const inner = [...open, raw];
        if (Array.isArray(raw)) {
          if (prototype !== Array.prototype) refuse(path, 'an array subclass');
          const extra = keys.find((key) => key !== 'length' && !(typeof key === 'string' && String(Number(key) >>> 0) === key && Number(key) < raw.length));
          if (extra !== undefined) refuse(path, 'an array with property ' + String(extra));
          const out = [];
          for (let index = 0; index < raw.length; index++) {
            const item = field(raw, String(index), path + '[' + index + ']');
            if (item === undefined) refuse(path + '[' + index + ']', 'an undefined array element');
            out.push(copy(item, path + '[' + index + ']', inner));
          }
          return out;
        }
        if (prototype !== Object.prototype && prototype !== null) refuse(path, 'a ' + (prototype?.constructor?.name ?? 'non-plain object'));
        const out = Object.create(null);
        for (const key of keys) {
          if (typeof key === 'symbol') refuse(path, 'a symbol-keyed property');
          const item = field(raw, key, path + '[' + JSON.stringify(key) + ']');
          if (item !== undefined) out[key] = copy(item, path + '[' + JSON.stringify(key) + ']', inner);
        }
        return out;
      }
      default:
        return refuse(path, 'a ' + typeof raw);
    }
  };
  try {
    return JSON.stringify(value === undefined ? {} : { result: copy(value, 'value', []) });
  } catch (error) {
    return JSON.stringify({ refused: error instanceof Refused ? error.reason : String(error) });
  }
}`;
const Evaluation = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.optional(Schema.Unknown),
    refused: Schema.optional(Schema.String),
    thrown: Schema.optional(Schema.String),
  }),
);
const ChannelMessage = Schema.fromJsonString(
  Schema.Union([Schema.Struct({ hello: Schema.String }), Schema.Struct({ call: Schema.Number, text: Schema.String })]),
);
const channelScript = (url: string) => `(() => {
  if (globalThis.__runlithChannel) return;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  globalThis.__runlithChannel = id;
  const socket = new WebSocket(${JSON.stringify(url)});
  socket.onopen = () => socket.send(JSON.stringify({ hello: id }));
  socket.onmessage = async (event) => {
    const { call, expression } = JSON.parse(event.data);
    let text;
    try { text = (${transfer})(await (0, eval)('(' + expression + ')')); }
    catch (error) { text = JSON.stringify({ thrown: String((error && error.stack) || error) }); }
    socket.send(JSON.stringify({ call, text }));
  };
})()`;
const Viewport = Schema.Struct({ title: Schema.String, x: Schema.Number, y: Schema.Number, width: Schema.Number });
const evaluatePage = async (debugger_: RemoteDebugger, expression: string): Promise<unknown> => {
  const evaluation = decode(
    Evaluation,
    await debugger_.executeAtom('execute_script', [`return (async () => (${transfer})(await (${expression})))()`, []]),
  );
  if (evaluation.refused !== undefined)
    throw new UntransferableValue({ message: `the page value is not JSON-representable: ${evaluation.refused}` });
  return evaluation.result;
};
const connectInspector = async (debugger_: RemoteDebugger, pid: number): Promise<void> => {
  await debugger_.connect();
  await new Promise<void>((resolve, reject) => {
    const events = ['_rpc_reportConnectedApplicationList:', '_rpc_applicationConnected:', '_rpc_applicationUpdated:'];
    const cleanup = () => {
      for (const event of events) debugger_.removeClientEventListener(event);
      debugger_.off('remote_debugger_disconnect', disconnected);
    };
    const disconnected = () => {
      cleanup();
      reject(new IOSUnavailable({ message: 'Web Inspector disconnected before Safari appeared' }));
    };
    const check = () => {
      if (Object.entries(debugger_.appDict).some(([key, app]) => key === `PID:${pid}` && app.bundleId === 'com.apple.mobilesafari')) {
        cleanup();
        resolve();
      }
    };
    for (const event of events) debugger_.addClientEventListener(event, check);
    debugger_.once('remote_debugger_disconnect', disconnected);
    check();
  });
};

const pageRecording = async (
  debugger_: RemoteDebugger,
  selector: string,
  servers: Set<ReturnType<typeof Bun.serve>>,
): Promise<ScrollCapture> => {
  let resolve!: (value: ScrollRecording) => void;
  let reject!: (cause: unknown) => void;
  const result = new Promise<ScrollRecording>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      try {
        const recording = decode(ScrollRecording, await request.json());
        resolve(recording);
        return new Response('recorded', { headers: { 'Access-Control-Allow-Origin': '*' } });
      } catch (cause) {
        reject(cause);
        return new Response('invalid recording', { status: 400 });
      }
    },
  });
  servers.add(server);
  await evaluatePage(debugger_, `(${startRecording})(${JSON.stringify({ selector, endpoint: server.url.href })})`);
  return { result };
};

type IOSPrepared = { readonly fixture: IOSSession; readonly failed: Deferred.Deferred<never, PageFailed | IOSUnavailable> };
const preparedSession = Effect.fn('e2e.iosSession')(function* (
  options: SimulatorOptions,
): Effect.fn.Return<IOSPrepared, IOSUnavailable, Scope.Scope> {
  const held = yield* simulator(options).pipe(Effect.mapError((cause) => new IOSUnavailable({ message: cause.message, cause })));
  const { udid, runtime, timing } = held;
  let selected: RemoteDebugger | undefined;
  let application: number | undefined;
  let page = '';
  const console: string[] = [];
  const failed = yield* Deferred.make<never, PageFailed | IOSUnavailable>();
  let stopBootstrap: (() => void) | undefined;
  const servers = new Set<ReturnType<typeof Bun.serve>>();
  yield* Effect.addFinalizer(() =>
    attempted('the iOS page inspection did not close', async () => {
      stopBootstrap?.();
      for (const server of servers) await server.stop(true);
      if (selected !== undefined) await selected.disconnect();
    }).pipe(Effect.orDie),
  );
  const inspect = (): RemoteDebugger => {
    if (selected === undefined) throw new IOSUnavailable({ message: 'open a page before evaluating or recording it' });
    return selected;
  };
  const errors = yield* Effect.sync(() =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        try {
          const error = decode(PageException, await request.json());
          Deferred.doneUnsafe(failed, Effect.fail(pageFailure(error)));
          return new Response('reported', { headers: { 'Access-Control-Allow-Origin': '*' } });
        } catch (cause) {
          Deferred.doneUnsafe(failed, Effect.fail(new IOSUnavailable({ message: 'a page error report could not be decoded', cause })));
          return new Response('invalid error report', { status: 400 });
        }
      },
    }),
  );
  servers.add(errors);
  type Socket = Bun.ServerWebSocket<unknown>;
  const sockets = new Map<string, Socket>();
  const arrivals = new Map<string, (socket: Socket) => void>();
  const calls = new Map<
    number,
    { readonly socket: Socket; readonly resolve: (text: string) => void; readonly reject: (cause: unknown) => void }
  >();
  let sequence = 0;
  let current: string | undefined;
  const channel = yield* Effect.sync(() =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return undefined;
        return new Response('the page channel accepts WebSocket upgrades only', { status: 400 });
      },
      websocket: {
        message(socket, message) {
          const decoded = decode(ChannelMessage, String(message));
          if ('hello' in decoded) {
            sockets.set(decoded.hello, socket);
            arrivals.get(decoded.hello)?.(socket);
            arrivals.delete(decoded.hello);
            return;
          }
          const call = calls.get(decoded.call);
          calls.delete(decoded.call);
          call?.resolve(decoded.text);
        },
        close(socket) {
          for (const [id, held] of sockets) if (held === socket) sockets.delete(id);
          for (const [id, call] of calls)
            if (call.socket === socket) {
              calls.delete(id);
              call.reject(new IOSUnavailable({ message: 'the page left before answering an evaluation' }));
            }
        },
      },
    }),
  );
  servers.add(channel);
  const script = `void (${errorScript(
    `value => fetch(${JSON.stringify(errors.url.href)}, {method:'POST',body:JSON.stringify(value),keepalive:true})`,
  )}, ${channelScript(`ws://127.0.0.1:${channel.port}/`)})`;
  const evaluateChannel = async (expression: string): Promise<unknown> => {
    const id = current;
    if (id === undefined) throw new IOSUnavailable({ message: 'open a page before evaluating it' });
    const socket = sockets.get(id) ?? (await new Promise<Socket>((resolve) => arrivals.set(id, resolve)));
    const call = ++sequence;
    const text = await new Promise<string>((resolve, reject) => {
      calls.set(call, { socket, resolve, reject });
      socket.send(JSON.stringify({ call, expression }));
    });
    const evaluation = decode(Evaluation, text);
    if (evaluation.refused !== undefined)
      throw new UntransferableValue({ message: `the page value is not JSON-representable: ${evaluation.refused}` });
    if (evaluation.thrown !== undefined) throw new IOSUnavailable({ message: `the page expression threw: ${evaluation.thrown}` });
    return evaluation.result;
  };
  const mapping = async (): Promise<(point: Point) => Point> => {
    const viewport = decode(
      Viewport,
      await evaluatePage(
        inspect(),
        '({title:document.title,x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width})',
      ),
    );
    if (application === undefined) throw new IOSUnavailable({ message: 'open a page before mapping its coordinates' });
    const frame = await held.webFrame(viewport.title, application);
    const scale = frame.width / viewport.width;
    return (point) => ({ x: frame.x + (point.x - viewport.x) * scale, y: frame.y + (point.y - viewport.y) * scale });
  };
  const touch = yield* makeTouch<Point>({ frame: mapping, send: held.touch });
  const fixture: IOSSession = {
    touch,
    udid,
    deviceSet: held.deviceSet,
    runtime,
    timing,
    open: async (url) => {
      if (selected === undefined) {
        const pid = await held.launchSafari();
        selected = createRemoteDebugger(
          {
            socketPath: await held.socket(),
            bundleId: 'com.apple.mobilesafari',
            isSafari: true,
            platformVersion: runtime,
            garbageCollectOnExecute: false,
          },
          false,
        );
        await connectInspector(selected, pid);
        selected.startConsole((...args) => console.push(JSON.stringify(args)));
        const pages = (await selected.selectApp()).filter(
          (one) => one.bundleId === 'com.apple.mobilesafari' && Number(String(one.id).split('.')[0]) === pid,
        );
        const browsing = pages.find((one) => one.isKey) ?? pages[0];
        if (browsing === undefined) throw new IOSUnavailable({ message: `MobileSafari ${pid} exposed no browsing page` });
        const pageId = Number(String(browsing.id).split('.')[1]);
        await selected.selectPage(pid, pageId, true);
        application = pid;
        page = String(pageId);
        stopBootstrap = await bootstrap(selected, { appId: pid, pageId }, script, (cause) =>
          Deferred.doneUnsafe(failed, Effect.fail(new IOSUnavailable({ message: 'the page error bootstrap failed', cause }))),
        );
        await evaluatePage(selected, script);
      }
      const debugger_ = selected;
      const from = new URL(decode(Schema.String, await evaluatePage(debugger_, 'location.href')));
      const to = new URL(url, from);
      if (to.href.includes('#') && from.origin === to.origin && from.pathname === to.pathname && from.search === to.search) {
        await evaluatePage(
          debugger_,
          `new Promise(resolve => {
          const target = ${JSON.stringify(to.href)};
          if (location.href === target) { resolve(); return; }
          const changed = () => { if (location.href === target) { removeEventListener('hashchange', changed); resolve(); } };
          addEventListener('hashchange', changed); location.href = target;
        })`,
        );
        current = decode(Schema.String, await evaluatePage(debugger_, 'globalThis.__runlithChannel'));
        return;
      }
      const loaded = new Promise<void>((resolve, reject) => {
        const disconnect = () => {
          debugger_.removeClientEventListener('Page.loadEventFired');
          reject(new IOSUnavailable({ message: `MobileSafari disconnected while opening ${url}` }));
        };
        debugger_.addClientEventListener('Page.loadEventFired', () => {
          debugger_.removeClientEventListener('Page.loadEventFired');
          debugger_.off('remote_debugger_disconnect', disconnect);
          resolve();
        });
        debugger_.once('remote_debugger_disconnect', disconnect);
      });
      if (application === undefined) throw new IOSUnavailable({ message: 'open a page before navigating it' });
      await debugger_.requireRpcClient().send('Runtime.evaluate', {
        expression: `window.location.href = ${JSON.stringify(to.href)};`,
        appIdKey: `PID:${application}`,
        pageIdKey: page,
      });
      await loaded;
      const landed = decode(
        Schema.Struct({ href: Schema.String, channel: Schema.String }),
        await evaluatePage(debugger_, '({href: location.href, channel: globalThis.__runlithChannel})'),
      );
      if (landed.href !== to.href) throw new IOSUnavailable({ message: `MobileSafari loaded ${landed.href} while opening ${to.href}` });
      current = landed.channel;
    },
    evaluate: async (expression, schema) => decode(schema, await evaluateChannel(expression)),
    swipe: held.swipe,
    tap: held.tap,
    pagePoint: async (point) => (await mapping())(point),
    screenshot: held.screenshot,
    recording: (selector) => pageRecording(inspect(), selector, servers),
  };
  const unhook = onFailure(async (directory) => {
    const results = await Promise.allSettled([
      fixture.screenshot(join(directory, 'screenshot.png')),
      Bun.write(join(directory, 'ios-driver.log'), held.diagnostics()),
      Bun.write(join(directory, 'console.log'), console.join('\n')),
      current === undefined
        ? Promise.resolve()
        : evaluateChannel('window.__runlithIOSRecording').then((value) =>
            Bun.write(join(directory, 'ios-recording.json'), JSON.stringify(value ?? null)),
          ),
    ]);
    const failures = results.flatMap((one) => (one.status === 'rejected' ? [one.reason] : []));
    if (failures.length > 0) throw new AggregateError(failures, 'iOS failure evidence was incomplete');
  });
  yield* Effect.addFinalizer(() => Effect.sync(unhook));
  return { fixture, failed };
});

export const iosSession = (options: SimulatorOptions): Effect.Effect<IOSSession, IOSUnavailable, Scope.Scope> =>
  preparedSession(options).pipe(Effect.map((prepared) => prepared.fixture));

const execute = Effect.fn('e2e.iosRecording')(function* <E>(
  name: string,
  options: SimulatorOptions,
  body: (fixture: IOSTest) => Effect.Effect<void, E, Scope.Scope>,
) {
  yield* recorded(name, (artifacts) =>
    Effect.gen(function* () {
      const { fixture, failed } = yield* preparedSession(options);
      yield* Effect.raceFirst(
        body({ ...fixture, artifacts }).pipe(Effect.andThen(Effect.promise(() => fixture.evaluate(flushErrors, Schema.Void)))),
        Deferred.await(failed),
      );
    }),
  );
});
const runtimes = (options: IOSRun): readonly string[] => {
  if (process.env.E2E_LANES !== undefined && !process.env.E2E_LANES.split(',').includes('ios')) return [];
  const filter = process.env.E2E_IOS_RUNTIMES?.split(',');
  return (options.runtimes ?? filter ?? ['26']).filter((runtime) => filter === undefined || filter.includes(runtime));
};
const register = (name: string, body: (fixture: IOSTest) => Promise<void>, options: IOSRun = {}): void =>
  registerEffect(name, (fixture) => Effect.promise(() => body(fixture)), options);
let lane: (() => void) | undefined;
const registerEffect = <E>(name: string, body: (fixture: IOSTest) => Effect.Effect<void, E, Scope.Scope>, options: IOSRun = {}): void => {
  if (runtimes(options).length > 0 && lane === undefined) {
    lane = holdLane();
    afterAll(() => {
      lane?.();
      lane = undefined;
    });
  }
  for (const runtime of runtimes(options)) {
    const title = `${name} [ios-${runtime}]`;
    beforeAll(() => Effect.runPromise(prepareSimulator({ runtime, deviceType: options.deviceType })));
    it.live(title, () => execute(title, { runtime, deviceType: options.deviceType }, body), Infinity);
  }
};
export const ios = Object.assign(register, { effect: registerEffect });
