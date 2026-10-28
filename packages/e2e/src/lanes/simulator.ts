import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { holding, runLiveness, runRoot } from '@runlith/testbed/fixture';
import { once, runKind } from '@runlith/testbed/worlds';
import { Clock, Data, Effect, Exit, Fiber, FileSystem, Option, Schedule, Schema, type Scope } from 'effect';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cacheDirectory, cachedTools, COMPANION_VERSION, CLIENT_VERSION, PYTHON_VERSION, type Tools } from './iosTools.ts';
import { nativeTouch, type NativeTouch } from './hid.ts';

export class SimulatorUnavailable extends Data.TaggedError('SimulatorUnavailable')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
import type { Point, Swipe, SimulatorOptions, SimulatorTiming } from './ios.ts';

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
type Device = { readonly udid: string; readonly set: string };
type TemplateParams = {
  readonly runtime: string;
  readonly deviceType: string;
  readonly companion: string;
  readonly client: string;
  readonly python: string;
};
type Template = { readonly udid: string; readonly runtime: string; readonly set: string };
type Input = {
  readonly run: (...args: string[]) => Promise<string>;
  readonly quiet: (pid: number) => Promise<void>;
  readonly diagnostics: () => string;
  readonly touch: NativeTouch;
};

const command = (file: string, args: readonly string[], signal?: AbortSignal, progress?: (text: string) => void): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(file, [...args], { signal, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (cause, stdout, stderr) => {
      if (cause === null) resolve(stdout.trim());
      else reject(new SimulatorUnavailable({ message: `${file} ${args.join(' ')} failed\n${stderr.trim()}\n${stdout.trim()}`, cause }));
    });
    if (progress !== undefined) child.stdout?.on('data', progress);
  });
const simctl = (set: string, ...args: string[]) => command('xcrun', ['simctl', '--set', set, ...args]);
const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new SimulatorUnavailable({ message, cause }) });
const decode = <A>(schema: Schema.Decoder<A>, value: unknown): A => Schema.decodeUnknownSync(schema)(value);
const SafariLaunch = Schema.String.check(Schema.isPattern(/^com\.apple\.mobilesafari:\s*\d+$/u));
const ServicePID = /"PID"\s*=\s*(\d+);/u;
const ServiceIdentity = Schema.String.check(Schema.isPattern(ServicePID));
const Verdict = Schema.fromJsonString(
  Schema.Struct({ retry: Schema.Literals(['safe', 'safe_after_reread', 'unsafe']), retry_reason: Schema.String }),
);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};
const Runtimes = Schema.Struct({
  runtimes: Schema.Array(Schema.Struct({ identifier: Schema.String, version: Schema.String, isAvailable: Schema.Boolean })),
});
const Devices = Schema.Struct({
  devices: Schema.Record(Schema.String, Schema.Array(Schema.Struct({ udid: Schema.String, name: Schema.String, state: Schema.String }))),
});
const ButtonType = 9;
const DisabledTrait = 0x100;
const BridgeScalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
type BridgeScalar = typeof BridgeScalar.Type;
const BridgeFrame = Schema.Struct({
  X: Schema.optional(Schema.Number),
  Y: Schema.optional(Schema.Number),
  Width: Schema.optional(Schema.Number),
  Height: Schema.optional(Schema.Number),
});
const PositionedFrame = Schema.Struct({
  X: Schema.Finite,
  Y: Schema.Finite,
  Width: Schema.Finite.check(Schema.isGreaterThan(0)),
  Height: Schema.Finite.check(Schema.isGreaterThan(0)),
});
type BridgeNode = {
  readonly XC_kAXXCAttributeElementType?: BridgeScalar | null;
  readonly XC_kAXXCAttributeAutomationType?: BridgeScalar | null;
  readonly XC_kAXXCAttributeTraits?: number | null;
  readonly XC_kAXXCAttributeIdentifier?: BridgeScalar | null;
  readonly XC_kAXXCAttributeLabel?: BridgeScalar | null;
  readonly XC_kAXXCAttributeFrame?: typeof BridgeFrame.Type | null;
  readonly XC_kAXXCAttributeChildren?: readonly BridgeNode[] | null;
};
const BridgeNode: Schema.Codec<BridgeNode> = Schema.suspend(() =>
  Schema.Struct({
    XC_kAXXCAttributeElementType: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeAutomationType: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeTraits: Schema.optional(Schema.NullOr(Schema.Number)),
    XC_kAXXCAttributeIdentifier: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeLabel: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeFrame: Schema.optional(Schema.NullOr(BridgeFrame)),
    XC_kAXXCAttributeChildren: Schema.optional(Schema.NullOr(Schema.Array(BridgeNode))),
  }),
);
const BridgeReply = Schema.Union([
  Schema.Struct({ tree: Schema.Struct({ response: Schema.Struct({ tree: BridgeNode }) }) }),
  Schema.Struct({ failure: Schema.Struct({ reason: Schema.Struct({ error: Schema.String }) }) }),
]);
type AXRead = {
  readonly pid: number;
  readonly automation: boolean;
  readonly depth: number;
  readonly nodes: number;
  readonly traversal: 'view-hierarchy' | 'single-fetch';
};
const readAX = async (device: Device, tools: Tools, input: AXRead): Promise<BridgeNode> => {
  const raw = await simctl(
    device.set,
    'spawn',
    device.udid,
    tools.bridge,
    'accessibility',
    'describe',
    '--pid',
    String(input.pid),
    '--max-depth',
    String(input.depth),
    '--max-nodes',
    String(input.nodes),
    '--traversal',
    input.traversal,
    '--client-type',
    '0',
    '--automation-mode',
    String(input.automation),
  );
  const reply = decode(BridgeReply, JSON.parse(raw));
  if ('failure' in reply) throw new SimulatorUnavailable({ message: reply.failure.reason.error });
  return reply.tree.response.tree;
};

const elementsOf = (root: BridgeNode): BridgeNode[] => {
  const elements = [root];
  for (let index = 0; index < elements.length; index++) elements.push(...(elements[index]!.XC_kAXXCAttributeChildren ?? []));
  return elements;
};
const launchSafari = async (device: Device): Promise<number> => {
  const launched = decode(SafariLaunch, await simctl(device.set, 'launch', device.udid, 'com.apple.mobilesafari'));
  return Number(launched.slice(launched.indexOf(':') + 1));
};
const readSystemPID = async (device: Device): Promise<number> => {
  const identity = decode(ServiceIdentity, await simctl(device.set, 'spawn', device.udid, 'launchctl', 'list', 'com.apple.SpringBoard'));
  return Number(ServicePID.exec(identity)![1]);
};

const remove = async (device: Device): Promise<void> => {
  const listed = decode(Devices, JSON.parse(await simctl(device.set, 'list', 'devices', '-j')));
  const current = Object.values(listed.devices)
    .flat()
    .find((one) => one.udid === device.udid);
  if (current === undefined) return;
  if (current.state !== 'Shutdown') await simctl(device.set, 'shutdown', device.udid);
  await simctl(device.set, 'delete', device.udid);
};
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
            yield* attempted('an ended run could not shut down its Simulator devices', () => simctl(set, 'shutdown', 'all'));
            yield* attempted('an ended run could not delete its Simulator devices', () => simctl(set, 'delete', 'all'));
            yield* attempted(
              'the ended Simulator set did not report empty',
              async () => Object.values(decode(Devices, JSON.parse(await simctl(set, 'list', 'devices', '-j'))).devices).flat().length,
            ).pipe(Effect.repeat({ while: (count) => count > 0, schedule: Schedule.spaced(100) }));
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
const boot = Effect.fn('e2e.iosBoot')(function* (device: Device) {
  yield* Effect.tryPromise({
    try: async (signal) => {
      await command('xcrun', ['simctl', '--set', device.set, 'boot', device.udid], signal);
      await command('xcrun', ['simctl', '--set', device.set, 'bootstatus', device.udid, '-b'], signal, (text) =>
        process.stdout.write(text),
      );
    },
    catch: (cause) => new SimulatorUnavailable({ message: `iOS device ${device.udid} did not boot`, cause }),
  });
});
const input = Effect.fn('e2e.iosInput')(function* (device: Device, tools: Tools) {
  let stderr = '';
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const stop = holding();
        try {
          const child = spawn(
            tools.companion,
            ['--udid', device.udid, '--only', 'simulator', '--device-set-path', device.set, '--grpc-port', '0'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );
          child.stderr.on('data', (data: Buffer) => {
            stderr = (stderr + data.toString()).slice(-65536);
          });
          return child;
        } finally {
          stop();
        }
      },
      catch: (cause) => new SimulatorUnavailable({ message: `the pinned iOS input driver ${tools.companion} could not start`, cause }),
    }),
    (child) =>
      attempted(
        'the iOS input driver did not close',
        () =>
          new Promise<void>((resolve, reject) => {
            if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once('error', reject);
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
          }),
      ).pipe(Effect.orDie),
  );
  const port = yield* attempted(
    'the iOS input driver opened no gRPC port',
    () =>
      new Promise<number>((resolve, reject) => {
        const lines = createInterface({ input: child.stdout });
        child.once('error', reject);
        lines.on('line', (line) => {
          if (!line.startsWith('{')) return;
          try {
            resolve(decode(Schema.Struct({ grpc_port: Schema.Number }), JSON.parse(line)).grpc_port);
          } catch (cause) {
            reject(cause);
          }
        });
        lines.once('close', () => reject(new Error(stderr)));
      }),
  );
  const answered = (pid: number) =>
    new Promise<boolean>((resolve, reject) => {
      const args = [
        '--companion',
        `localhost:${port}`,
        '--retry-verdict',
        'ui',
        'quiet',
        '0',
        '--pid',
        String(pid),
        '--json',
        '--udid',
        device.udid,
      ];
      execFile(tools.client, args, { encoding: 'utf8' }, (cause, out, err) => {
        try {
          const verdict = cause === null ? undefined : Schema.decodeUnknownOption(Verdict)(err.trim().split('\n').at(-1));
          if (verdict === undefined) resolve(true);
          else if (Option.isSome(verdict) && verdict.value.retry === 'safe' && alive(pid)) resolve(false);
          else
            reject(
              new SimulatorUnavailable({
                message: `the native interface of pid ${pid} did not go quiet\n${err.trim()}\n${out.trim()}`,
                cause,
              }),
            );
        } catch (failure) {
          reject(failure);
        }
      });
    });
  const control: Input = {
    run: (...args) => command(tools.client, ['--companion', `localhost:${port}`, ...args, '--udid', device.udid]),
    quiet: async (pid) => {
      while (!(await answered(pid))) console.info(`iOS: pid ${pid} has not answered accessibility yet`);
    },
    diagnostics: () => stderr,
    touch: yield* nativeTouch({ tools, port }),
  };
  return control;
});
const tap = async (control: Input, point: Point): Promise<void> => {
  await control.run('ui', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
};
const onboarding = Effect.fn('e2e.iosOnboarding')(function* (device: Device, control: Input, tools: Tools) {
  let ready = false;
  const html =
    '<!doctype html><title>Safari template</title><p>Ready</p><script>requestAnimationFrame(()=>requestAnimationFrame(()=>fetch("/ready",{method:"POST"})))</script>';
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          if (new URL(request.url).pathname === '/ready') {
            ready = true;
            return new Response('ready');
          }
          return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
        },
      }),
    ),
    (server) =>
      Effect.promise(async () => {
        await server.stop(true);
      }),
  );
  const pid = yield* attempted('MobileSafari did not launch', () => launchSafari(device));
  const systemPID = yield* attempted('the native system UI process is unavailable', () => readSystemPID(device));
  const navigation = yield* Effect.forkScoped(
    Effect.tryPromise({
      try: (signal) => command('xcrun', ['simctl', '--set', device.set, 'openurl', device.udid, server.url.href], signal),
      catch: (cause) => new SimulatorUnavailable({ message: 'MobileSafari did not open its setup page', cause }),
    }),
  );
  const interaction = Effect.gen(function* () {
    for (;;) {
      console.info('iOS onboarding: waiting for the native interface');
      yield* attempted('the native interface did not become quiet', async () => {
        await control.quiet(pid);
        await control.quiet(systemPID);
      });
      console.info('iOS onboarding: reading native accessibility');
      const snapshot = async (target: number) =>
        elementsOf(await readAX(device, tools, { pid: target, automation: true, depth: 64, nodes: 4096, traversal: 'single-fetch' }));
      const [elements, systemElements] = yield* attempted('the native accessibility tree is unavailable', () =>
        Promise.all([snapshot(pid), snapshot(systemPID)]),
      );
      const hasSystemAlert = systemElements.some((one) => one.XC_kAXXCAttributeLabel === 'Search Engine Preference');
      const popover = elements.some((one) => one.XC_kAXXCAttributeIdentifier === 'PopoverDismissRegion');
      const buttons = (hasSystemAlert ? systemElements : elements).filter(
        (one) => one.XC_kAXXCAttributeAutomationType === ButtonType && ((one.XC_kAXXCAttributeTraits ?? 0) & DisabledTrait) === 0,
      );
      const button =
        buttons.find((one) => one.XC_kAXXCAttributeLabel === 'Continue') ??
        (!hasSystemAlert && popover ? buttons.find((one) => one.XC_kAXXCAttributeLabel === 'Close') : undefined);
      if (button !== undefined) {
        const frame = yield* Schema.decodeUnknownEffect(PositionedFrame)(button.XC_kAXXCAttributeFrame).pipe(
          Effect.mapError((cause) => new SimulatorUnavailable({ message: 'the native onboarding button has no usable frame', cause })),
        );
        yield* attempted('the native onboarding button did not accept a tap', () =>
          tap(control, { x: frame.X + frame.Width / 2, y: frame.Y + frame.Height / 2 }),
        );
      } else if (ready && !hasSystemAlert && !popover && elements.some((one) => one.XC_kAXXCAttributeIdentifier === 'ReloadButton')) return;
      else yield* Effect.sleep(100);
    }
  });
  yield* Effect.raceFirst(interaction, Fiber.join(navigation).pipe(Effect.andThen(Effect.never)));
  yield* Fiber.join(navigation);
  return pid;
});
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
    const set = join(home, `set-${crypto.randomUUID()}`);
    yield* Effect.gen(function* () {
      yield* files.makeDirectory(home, { recursive: true });
      const draft = join(home, `run.${crypto.randomUUID()}.draft`);
      yield* files.writeFileString(draft, JSON.stringify({ root }));
      yield* files.rename(draft, join(home, 'run.json'));
      yield* files.makeDirectory(set, { recursive: true });
    }).pipe(
      Effect.mapError(
        (cause) => new SimulatorUnavailable({ message: 'the private Simulator device set could not be registered and made', cause }),
      ),
    );
    const runtime = yield* attempted('the requested iOS runtime is unavailable', async () => {
      const listed = decode(Runtimes, JSON.parse(await command('xcrun', ['simctl', 'list', 'runtimes', '-j'])));
      const found = listed.runtimes
        .filter(
          (one) =>
            one.isAvailable &&
            one.identifier.includes('.iOS-') &&
            (one.identifier === params.runtime || one.version === params.runtime || one.version.startsWith(`${params.runtime}.`)),
        )
        .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
      if (found === undefined) throw new Error(`install an iOS ${params.runtime} runtime in Xcode`);
      return found;
    });
    const udid = yield* Effect.acquireRelease(
      attempted('the Safari template could not be created', () =>
        simctl(set, 'create', 'runlith-e2e-ios-template', params.deviceType, runtime.identifier),
      ),
      (udid, exit) =>
        attempted('the Safari template did not shut down', () =>
          Exit.isSuccess(exit) ? simctl(set, 'shutdown', udid).then(() => undefined) : remove({ set, udid }),
        ).pipe(Effect.orDie),
    );
    const device = { set, udid };
    yield* boot(device);
    const control = yield* input(device, tools);
    const pid = yield* onboarding(device, control, tools);
    yield* attempted('the template could not leave accessibility automation mode', () =>
      readAX(device, tools, { pid, automation: false, depth: 1, nodes: 8, traversal: 'view-hierarchy' }),
    );
    yield* attempted('the template Safari process did not terminate', () => simctl(set, 'terminate', udid, 'com.apple.mobilesafari'));
    return { udid, runtime: runtime.version, set };
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

export const simulator = Effect.fn('e2e.iosSimulator')(function* (
  options: SimulatorOptions,
): Effect.fn.Return<Simulator, SimulatorUnavailable, Scope.Scope> {
  const tools = yield* cachedTools().pipe(Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause })));
  const template = yield* once(templates, parameters(options));
  const set = template.value.set;
  const started = yield* Clock.currentTimeMillis;
  const udid = yield* Effect.acquireRelease(
    attempted('the Safari template could not be cloned', () =>
      simctl(set, 'clone', template.value.udid, `runlith-e2e-ios-${process.pid}-${crypto.randomUUID()}`),
    ),
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
