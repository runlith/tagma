import { Data, Effect, Schedule, Schema } from 'effect';
import { execFile } from 'node:child_process';

export class SimulatorUnavailable extends Data.TaggedError('SimulatorUnavailable')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
export type Device = { readonly udid: string; readonly set: string };

export const command = (file: string, args: readonly string[], signal?: AbortSignal, progress?: (text: string) => void): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(file, [...args], { signal, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (cause, stdout, stderr) => {
      if (cause === null) resolve(stdout.trim());
      else reject(new SimulatorUnavailable({ message: `${file} ${args.join(' ')} failed\n${stderr.trim()}\n${stdout.trim()}`, cause }));
    });
    if (progress !== undefined) child.stdout?.on('data', progress);
  });
export const simctl = (set: string, ...args: string[]) => command('xcrun', ['simctl', '--set', set, ...args]);
export const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new SimulatorUnavailable({ message, cause }) });
export const decode = <A>(schema: Schema.Decoder<A>, value: unknown): A => Schema.decodeUnknownSync(schema)(value);

const SafariLaunch = Schema.String.check(Schema.isPattern(/^com\.apple\.mobilesafari:\s*\d+$/u));
const Devices = Schema.Struct({
  devices: Schema.Record(Schema.String, Schema.Array(Schema.Struct({ udid: Schema.String, name: Schema.String, state: Schema.String }))),
});

export const stateOf = async (device: Device): Promise<string | undefined> =>
  Object.values(decode(Devices, JSON.parse(await simctl(device.set, 'list', 'devices', '-j'))).devices)
    .flat()
    .find((one) => one.udid === device.udid)?.state;
export const remove = async (device: Device): Promise<void> => {
  const state = await stateOf(device);
  if (state === undefined) return;
  if (state !== 'Shutdown') await simctl(device.set, 'shutdown', device.udid);
  await simctl(device.set, 'delete', device.udid);
};
export const empty = Effect.fn('e2e.iosSetEmpty')(function* (set: string) {
  yield* attempted('a Simulator set could not shut down its devices', () => simctl(set, 'shutdown', 'all'));
  yield* attempted('a Simulator set could not delete its devices', () => simctl(set, 'delete', 'all'));
  yield* attempted(
    'a Simulator set did not report empty',
    async () => Object.values(decode(Devices, JSON.parse(await simctl(set, 'list', 'devices', '-j'))).devices).flat().length,
  ).pipe(Effect.repeat({ while: (count) => count > 0, schedule: Schedule.spaced(100) }));
});
export const boot = Effect.fn('e2e.iosBoot')(function* (device: Device) {
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
export const launchSafari = async (device: Device): Promise<number> => {
  const launched = decode(SafariLaunch, await simctl(device.set, 'launch', device.udid, 'com.apple.mobilesafari'));
  return Number(launched.slice(launched.indexOf(':') + 1));
};
