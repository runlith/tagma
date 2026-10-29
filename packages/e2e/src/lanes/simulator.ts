import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { runLiveness, runRoot } from '@runlith/testbed/fixture';
import { once, runKind } from '@runlith/testbed/worlds';
import { closeOnExec, lockExclusive } from '@runlith/file-lock/flock';
import { Clock, Effect, FileSystem, Schema, type Scope } from 'effect';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { elementsOf, PositionedFrame, readAX } from './accessibility.ts';
import { attempted, boot, decode, empty, launchSafari, remove, simctl, SimulatorUnavailable } from './device.ts';
import type { NativeTouch } from './hid.ts';
import { input, tap } from './input.ts';
import type { Point, Swipe, SimulatorOptions, SimulatorTiming } from './ios.ts';
import { cacheDirectory, cachedTools, COMPANION_VERSION, CLIENT_VERSION, PYTHON_VERSION } from './iosTools.ts';
import { prepare, resolve, type Preparation, type TemplateParams } from './template.ts';

type Rect = Point & { readonly width: number; readonly height: number };
export type Simulator = {
  readonly udid: string;
  readonly deviceSet: string;
  readonly runtime: string;
  readonly timing: SimulatorTiming;
  readonly socket: () => Promise<string>;
  readonly launchSafari: () => Promise<number>;
  readonly screenshot: (path: string) => Promise<void>;
  readonly swipe: (gesture: Swipe) => Promise<void>;
  readonly tap: (point: Point) => Promise<void>;
  readonly touch: NativeTouch;
  readonly webFrame: (title: string, pid: number) => Promise<Rect>;
  readonly diagnostics: () => string;
};
type Template = { readonly preparation: Preparation; readonly runtime: string; readonly clones: string };

const RunRecord = Schema.fromJsonString(Schema.Struct({ root: Schema.String }));
const recover = Effect.fn('e2e.iosRecover')(
  function* (base: string) {
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(base, { recursive: true });
    yield* withFileLock(join(base, 'recovery.lock'), Infinity, () =>
      Effect.gen(function* () {
        for (const name of (yield* files.readDirectory(base)).filter((name) => /^[a-f0-9]{16}$/.test(name))) {
          const home = join(base, name);
          const record = join(home, 'run.json');
          if (!(yield* files.exists(record))) continue;
          const { root } = yield* Schema.decodeUnknownEffect(RunRecord)(yield* files.readFileString(record));
          if (yield* files.exists(root)) {
            const state = yield* attempted('testbed could not read a Simulator run identity', () => runLiveness(root));
            if (state === 'alive') continue;
            if (state === 'unknown')
              return yield* new SimulatorUnavailable({ message: `testbed does not recognize Simulator run ${root}` });
          }
          for (const child of (yield* files.readDirectory(home)).filter((name) => name.startsWith('set-'))) {
            const set = join(home, child);
            yield* empty(set);
            yield* files.remove(set, { recursive: true });
            console.info(`iOS retired ${set}: CoreSimulator reported 0 devices`);
          }
          yield* files.remove(home, { recursive: true });
        }
      }),
    );
  },
  (effect) =>
    Effect.mapError(
      effect,
      (cause) => new SimulatorUnavailable({ message: 'stranded private Simulator sets could not be recovered', cause }),
    ),
);
const templates = runKind(
  'e2e/IOSTemplate',
  Effect.fn('e2e.iosTemplate')(function* (
    params: TemplateParams,
    _directory: string,
  ): Effect.fn.Return<Template, SimulatorUnavailable, Scope.Scope | FileSystem.FileSystem> {
    if (process.platform !== 'darwin')
      return yield* new SimulatorUnavailable({ message: 'the iOS lane requires macOS with Xcode and an installed iOS Simulator runtime' });
    const tools = yield* cachedTools().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause })));
    const files = yield* FileSystem.FileSystem;
    const base = join(
      yield* cacheDirectory().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause }))),
      'simulators',
    );
    yield* recover(base);
    const root = runRoot();
    if (root === undefined) return yield* new SimulatorUnavailable({ message: 'the iOS lane requires a testbed run root' });
    const home = join(base, createHash('sha256').update(root).digest('hex').slice(0, 16));
    const clones = join(home, `set-${crypto.randomUUID()}`);
    yield* Effect.gen(function* () {
      yield* files.makeDirectory(home, { recursive: true });
      const draft = join(home, `run.${crypto.randomUUID()}.draft`);
      yield* files.writeFileString(draft, JSON.stringify({ root }));
      yield* files.rename(draft, join(home, 'run.json'));
      yield* files.makeDirectory(clones, { recursive: true });
    }).pipe(
      Effect.mapError(
        (cause) => new SimulatorUnavailable({ message: 'the private Simulator device set could not be registered and made', cause }),
      ),
    );
    const preparation = { base, params, tools, ...(yield* resolve(params.runtime)) };
    const prepared = yield* prepare(preparation, Effect.succeed);
    return { preparation, runtime: prepared.runtime, clones };
  }, Effect.provide(BunFileSystem.layer)),
);
const parameters = (options: SimulatorOptions): TemplateParams => ({
  runtime: options.runtime,
  deviceType: options.deviceType ?? 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  companion: COMPANION_VERSION,
  client: CLIENT_VERSION,
  python: PYTHON_VERSION,
});
export const prepareSimulator = (options: SimulatorOptions) => once(templates, parameters(options)).pipe(Effect.asVoid);
export const holdLane = (): (() => void) => {
  const base = join(Effect.runSync(cacheDirectory()), 'simulators');
  mkdirSync(base, { recursive: true });
  const handle = openSync(join(base, 'lane.lock'), 'a', 0o600);
  closeOnExec(handle);
  console.info('iOS lane: waiting for the machine-wide Simulator lane lock');
  while (lockExclusive(handle) === 'held') Bun.sleepSync(100);
  console.info('iOS lane: holding the Simulator lane lock');
  return () => closeSync(handle);
};
export const prepareTemplate = Effect.fn('e2e.iosTemplateAhead')(function* (options: SimulatorOptions) {
  const tools = yield* cachedTools().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause })));
  const base = join(
    yield* cacheDirectory().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause }))),
    'simulators',
  );
  const params = parameters(options);
  return yield* prepare({ base, params, tools, ...(yield* resolve(params.runtime)) }, Effect.succeed);
}, Effect.provide(BunFileSystem.layer));

export const simulator = Effect.fn('e2e.iosSimulator')(function* (
  options: SimulatorOptions,
): Effect.fn.Return<Simulator, SimulatorUnavailable, Scope.Scope> {
  const tools = yield* cachedTools().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause })));
  const template = yield* once(templates, parameters(options));
  const set = template.value.clones;
  const started = yield* Clock.currentTimeMillis;
  const udid = yield* Effect.acquireRelease(
    prepare(template.value.preparation, (source) =>
      attempted('the Safari template could not be cloned', () =>
        simctl(source.set, 'clone', source.udid, `runlith-e2e-ios-${process.pid}-${crypto.randomUUID()}`, set),
      ),
    ).pipe(Effect.provide(BunFileSystem.layer)),
    (udid) => attempted('the iOS clone did not shut down and delete', () => remove({ udid, set })).pipe(Effect.orDie),
  );
  const cloned = yield* Clock.currentTimeMillis;
  const device = { set, udid };
  yield* boot(device);
  const booted = yield* Clock.currentTimeMillis;
  const timing = { clone: cloned - started, boot: booted - cloned };
  console.info(`iOS ${template.value.runtime}: clone ${timing.clone} ms, boot ${timing.boot} ms`);
  const control = yield* input(device, tools);
  return {
    udid,
    deviceSet: set,
    runtime: template.value.runtime,
    timing,
    socket: () => simctl(set, 'getenv', udid, 'RWI_LISTEN_SOCKET'),
    launchSafari: async () => {
      const pid = await launchSafari(device);
      await control.quiet(pid);
      await readAX(device, tools, { pid, automation: true, depth: 1, nodes: 8, traversal: 'view-hierarchy' });
      console.info(`iOS native accessibility ready for Safari ${pid}`);
      return pid;
    },
    screenshot: async (path) => {
      await simctl(set, 'io', udid, 'screenshot', path);
    },
    tap: (point) => tap(control, point),
    touch: control.touch,
    swipe: async ({ from, to, duration = 0.15, delta = 5 }) => {
      await control.run(
        'ui',
        'swipe',
        String(Math.round(from.x)),
        String(Math.round(from.y)),
        String(Math.round(to.x)),
        String(Math.round(to.y)),
        '--duration',
        String(duration),
        '--delta',
        String(delta),
      );
    },
    webFrame: async (title, pid) => {
      const root = await readAX(device, tools, { pid, automation: true, depth: 64, nodes: 4096, traversal: 'view-hierarchy' });
      const elements = elementsOf(root);
      const view = elements.find((one) => one.XC_kAXXCAttributeIdentifier === 'WebView');
      if (view === undefined) throw new SimulatorUnavailable({ message: 'native accessibility exposed no Safari WebView' });
      const viewport = decode(PositionedFrame, view.XC_kAXXCAttributeFrame);
      const content = elements.find(
        (one) =>
          one.XC_kAXXCAttributeElementType === 'WebAccessibilityObjectWrapper' &&
          one.XC_kAXXCAttributeLabel === title &&
          one.XC_kAXXCAttributeFrame?.Width === viewport.Width,
      );
      if (content === undefined)
        throw new SimulatorUnavailable({ message: `native accessibility exposed no content frame for page ${JSON.stringify(title)}` });
      const frame = decode(PositionedFrame, content.XC_kAXXCAttributeFrame);
      return { x: frame.X, y: frame.Y, width: frame.Width, height: frame.Height };
    },
    diagnostics: control.diagnostics,
  };
});
