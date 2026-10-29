import { withFileLock } from '@runlith/file-lock/FileLock';
import { Effect, Exit, Fiber, FileSystem, Option, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ButtonType, DisabledTrait, elementsOf, PositionedFrame, readAX } from './accessibility.ts';
import {
  attempted,
  boot,
  command,
  decode,
  empty,
  launchSafari,
  remove,
  simctl,
  SimulatorUnavailable,
  stateOf,
  type Device,
} from './device.ts';
import { input, tap, type Input } from './input.ts';
import type { Tools } from './iosTools.ts';

export type TemplateParams = {
  readonly runtime: string;
  readonly deviceType: string;
  readonly companion: string;
  readonly client: string;
  readonly python: string;
};
type Prepared = { readonly udid: string; readonly runtime: string; readonly set: string };
const Runtime = Schema.Struct({
  identifier: Schema.String,
  version: Schema.String,
  buildversion: Schema.String,
  isAvailable: Schema.Boolean,
});
type Runtime = typeof Runtime.Type;
const Runtimes = Schema.Struct({ runtimes: Schema.Array(Runtime) });
export type Preparation = {
  readonly base: string;
  readonly params: TemplateParams;
  readonly runtime: Runtime;
  readonly installed: readonly string[];
  readonly coreSimulator: string;
  readonly tools: Tools;
};
const Identity = Schema.Struct({
  layout: Schema.Literal(1),
  identifier: Schema.String,
  build: Schema.String,
  coreSimulator: Schema.String,
  deviceType: Schema.String,
  companion: Schema.String,
  client: Schema.String,
  python: Schema.String,
});
type Identity = typeof Identity.Type;
const TemplateRecord = Schema.fromJsonString(Schema.Struct({ ...Identity.fields, udid: Schema.String, runtime: Schema.String }));
const superseded = (held: Identity, current: Identity, installed: readonly string[]): boolean =>
  held.companion !== current.companion ||
  held.client !== current.client ||
  held.python !== current.python ||
  held.coreSimulator !== current.coreSimulator ||
  !installed.includes(held.build) ||
  (held.identifier === current.identifier && held.deviceType === current.deviceType);
const ServicePID = /"PID"\s*=\s*(\d+);/u;
const ServiceIdentity = Schema.String.check(Schema.isPattern(ServicePID));
const readSystemPID = async (device: Device): Promise<number> => {
  const identity = decode(ServiceIdentity, await simctl(device.set, 'spawn', device.udid, 'launchctl', 'list', 'com.apple.SpringBoard'));
  return Number(ServicePID.exec(identity)![1]);
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
const CoreSimulatorInfo = '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/Info.plist';
export const resolve = (requested: string) =>
  attempted('the requested iOS runtime is unavailable', async () => {
    const available = decode(Runtimes, JSON.parse(await command('xcrun', ['simctl', 'list', 'runtimes', '-j']))).runtimes.filter(
      (one) => one.isAvailable && one.identifier.includes('.iOS-'),
    );
    const runtime = available
      .filter((one) => one.identifier === requested || one.version === requested || one.version.startsWith(`${requested}.`))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
    if (runtime === undefined) throw new Error(`install an iOS ${requested} runtime in Xcode`);
    const coreSimulator = await command('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', CoreSimulatorInfo]);
    return { runtime, installed: available.map((one) => one.buildversion), coreSimulator };
  });
const sweep = Effect.fn('e2e.iosTemplateSweep')(function* (
  directory: string,
  kept: string,
  current: Identity,
  installed: readonly string[],
) {
  const files = yield* FileSystem.FileSystem;
  for (const key of (yield* files.readDirectory(directory)).filter((name) => /^[a-f0-9]{16}$/.test(name) && name !== kept)) {
    yield* withFileLock(join(directory, `${key}.lock`), Infinity, () =>
      Effect.gen(function* () {
        const home = join(directory, key);
        if (!(yield* files.exists(home))) return;
        const record = join(home, 'template.json');
        const held = (yield* files.exists(record))
          ? Schema.decodeUnknownOption(TemplateRecord)(yield* files.readFileString(record))
          : Option.none();
        if (Option.isSome(held) && !superseded(held.value, current, installed)) return;
        const set = join(home, 'set');
        if (yield* files.exists(set)) yield* empty(set);
        yield* files.remove(home, { recursive: true });
        console.info(`iOS removed superseded template ${key}`);
      }),
    );
  }
});
export const prepare = Effect.fn('e2e.iosTemplatePrepare')(
  function* <A>(
    { base, params, runtime, installed, coreSimulator, tools }: Preparation,
    use: (template: Prepared) => Effect.Effect<A, SimulatorUnavailable>,
  ) {
    const files = yield* FileSystem.FileSystem;
    const identity: Identity = {
      layout: 1,
      identifier: runtime.identifier,
      build: runtime.buildversion,
      coreSimulator,
      deviceType: params.deviceType,
      companion: params.companion,
      client: params.client,
      python: params.python,
    };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
    const directory = join(base, 'templates');
    const home = join(directory, key);
    const set = join(home, 'set');
    const record = join(home, 'template.json');
    const lock = join(directory, `${key}.lock`);
    const ensure = Effect.scoped(
      Effect.gen(function* () {
        if (yield* files.exists(record)) {
          const held = yield* Schema.decodeUnknownEffect(TemplateRecord)(yield* files.readFileString(record));
          const state = yield* attempted('the prepared Safari template could not be read', () => stateOf({ set, udid: held.udid }));
          if (state === 'Shutdown') return { prepared: { udid: held.udid, runtime: held.runtime, set }, built: false };
          console.info(`iOS template ${key} is ${state ?? 'missing'}; preparing it again`);
          yield* files.remove(record);
        }
        if (yield* files.exists(set)) {
          yield* empty(set);
          yield* files.remove(set, { recursive: true });
        }
        yield* files.makeDirectory(set, { recursive: true });
        const udid = yield* Effect.acquireRelease(
          attempted('the Safari template could not be created', () =>
            simctl(set, 'create', 'runlith-e2e-ios-template', params.deviceType, runtime.identifier),
          ),
          (udid, exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : attempted('the failed Safari template was not removed', () => remove({ set, udid })).pipe(Effect.orDie),
        );
        const device = { set, udid };
        yield* boot(device);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const control = yield* input(device, tools);
            const pid = yield* onboarding(device, control, tools);
            yield* attempted('the template could not leave accessibility automation mode', () =>
              readAX(device, tools, { pid, automation: false, depth: 1, nodes: 8, traversal: 'view-hierarchy' }),
            );
            yield* attempted('the template Safari process did not terminate', () =>
              simctl(set, 'terminate', udid, 'com.apple.mobilesafari'),
            );
          }),
        );
        yield* attempted('the prepared Safari template did not shut down', () => simctl(set, 'shutdown', udid));
        const draft = join(home, `template.${crypto.randomUUID()}.draft`);
        yield* files.writeFileString(draft, JSON.stringify({ ...identity, udid, runtime: runtime.version }));
        yield* files.rename(draft, record);
        console.info(`iOS template ${key} prepared`);
        return { prepared: { udid, runtime: runtime.version, set }, built: true };
      }),
    );
    const { result, built } = yield* withFileLock(lock, Infinity, () =>
      Effect.gen(function* () {
        const { prepared, built } = yield* ensure;
        return { result: yield* use(prepared), built };
      }),
    );
    if (built) yield* sweep(directory, key, identity, installed);
    return result;
  },
  (effect) =>
    Effect.mapError(effect, (cause) =>
      cause instanceof SimulatorUnavailable
        ? cause
        : new SimulatorUnavailable({ message: 'the Safari template could not be prepared', cause }),
    ),
);
