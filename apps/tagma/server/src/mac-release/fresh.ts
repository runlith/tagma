import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import { type FreshHost, type FreshPlace, type FreshProcess, HostFailed } from '../fresh-world/contract/service/host.js';
import { CLI_ENTRY, RUNTIME_PART, SERVE_FLAGS } from '../installation/contract/wire/layout.js';
import { macPlatform } from '../installation/setup/macos.js';
import { RELEASE_INSIDE } from '../mac-applications/bundle.js';
import { verifiedBundle } from '../mac-applications/placement.js';
import { forgetRegistered, isolatedHome } from './home.js';

const KEYCHAIN = 'login.keychain';
//! -10814 is kLSApplicationNotFoundErr: LaunchServices never registered the bundle, so TCC keeps nothing for it
const UNREGISTERED = '-10814';
const NO_DOMAIN = 'not found';

type Answer = { readonly code: number; readonly stdout: string; readonly said: string };

const answered = (file: string, args: readonly string[], env?: Record<string, string>): Effect.Effect<Answer, HostFailed> =>
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn([file, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', ...(env === undefined ? {} : { env }) });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, stdout, said: `${stderr.trim()}\n${stdout.trim()}`.trim() };
    },
    catch: (error) => new HostFailed({ message: `${file} could not start: ${String(error)}` }),
  });

const failed = (file: string, args: readonly string[], answer: Answer) =>
  new HostFailed({ message: `${basename(file)} ${args.join(' ')}: ${answer.said || `exit ${answer.code}`}` });

const ran = (file: string, args: readonly string[], env?: Record<string, string>): Effect.Effect<Answer, HostFailed> =>
  Effect.flatMap(answered(file, args, env), (answer) =>
    answer.code === 0 ? Effect.succeed(answer) : Effect.fail(failed(file, args, answer)),
  );

const settled = (file: string, args: readonly string[], nothing: string): Effect.Effect<void, HostFailed> =>
  Effect.flatMap(answered(file, args), (answer) =>
    answer.code === 0 || answer.said.includes(nothing) ? Effect.void : Effect.fail(failed(file, args, answer)),
  );

const envOf = (place: FreshPlace) => isolatedHome(place.home, place.tmp, userInfo().username);

const plist = (bundle: string, key: string) =>
  Effect.map(ran('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(bundle, 'Contents', 'Info.plist')]), (read) => read.stdout.trim());

const nested = (bundle: string): string[] => {
  const found = [bundle];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(at, entry.name);
      if (entry.name.endsWith('.app')) found.push(path);
      walk(path);
    }
  };
  walk(join(bundle, 'Contents'));
  return found;
};

const killed = (pids: readonly number[], signal: 'SIGTERM' | 'SIGKILL') =>
  Effect.sync(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  });

const signed = Effect.fnUntraced(function* (bundle: string) {
  const refused = yield* verifiedBundle(bundle);
  if (refused !== null) return yield* new HostFailed({ message: refused });
  return bundle;
});

export const macFresh: FreshHost = {
  platform: Effect.mapError(macPlatform.current, (failure) => new HostFailed({ message: failure.reason })),
  image: Effect.fn('macFresh.image')(function* (image: string, into: string) {
    const volume = join(into, 'volume');
    yield* ran('/bin/mkdir', ['-p', volume]);
    yield* Effect.acquireRelease(
      ran('/usr/bin/hdiutil', ['attach', image, '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', volume]),
      () => Effect.orDie(ran('/usr/bin/hdiutil', ['detach', volume, '-force'])),
    );
    const name = readdirSync(volume).find((entry) => entry.endsWith('.app'));
    if (name === undefined) return yield* new HostFailed({ message: `${image} carries no application` });
    const bundle = join(into, name);
    yield* ran('/usr/bin/ditto', [join(volume, name), bundle]);
    return bundle;
  }, Effect.scoped),
  place: Effect.fn('macFresh.place')(function* (bundle: string, into: string) {
    const target = join(into, basename(bundle));
    yield* ran('/bin/cp', ['-cRp', bundle, target]);
    return yield* signed(target);
  }),
  version: (bundle) => plist(bundle, 'CFBundleShortVersionString'),
  keychain: Effect.fn('macFresh.keychain')(function* (place: FreshPlace) {
    const env = envOf(place);
    if (existsSync(join(place.home, 'Library', 'Keychains', `${KEYCHAIN}-db`))) {
      yield* ran('/usr/bin/security', ['unlock-keychain', '-p', '', KEYCHAIN], env);
      return;
    }
    yield* ran('/usr/bin/security', ['create-keychain', '-p', '', KEYCHAIN], env);
    yield* ran('/usr/bin/security', ['set-keychain-settings', KEYCHAIN], env);
  }),
  launch: Effect.fn('macFresh.launch')(function* (bundle: string, place: FreshPlace, running: boolean) {
    yield* ran('/usr/bin/open', running ? [bundle] : ['-n', bundle], envOf(place));
  }),
  processes: Effect.fn('macFresh.processes')(function* (root: string) {
    const prefixes = [root, ...(existsSync(root) ? [realpathSync(root)] : [])].map((one) => `${one}/`);
    const read = yield* ran('/bin/ps', ['-axo', 'pid=,comm=']);
    return read.stdout.split('\n').flatMap((line): FreshProcess[] => {
      const matched = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (matched === null) return [];
      const executable = matched[2]!.trim();
      return prefixes.some((prefix) => executable.startsWith(prefix)) ? [{ pid: Number(matched[1]), executable }] : [];
    });
  }),
  signal: killed,
  quit: (bundle, place) => {
    const carried = join(bundle, RELEASE_INSIDE);
    return ran(join(carried, RUNTIME_PART), [...SERVE_FLAGS, join(carried, CLI_ENTRY), 'quit', '--json'], envOf(place)).pipe(
      Effect.match({ onFailure: (failure) => failure.message, onSuccess: () => null }),
    );
  },
  window: (bundle) => `${join(bundle, 'Contents', 'MacOS')}/`,
  forget: Effect.fn('macFresh.forget')(function* (bundle: string) {
    const ids = yield* Effect.forEach(nested(bundle), (one) => plist(one, 'CFBundleIdentifier'));
    for (const id of ids) yield* settled('/usr/bin/tccutil', ['reset', 'All', id], UNREGISTERED);
    yield* settled('/usr/bin/defaults', ['delete', ids[0]!], NO_DOMAIN);
  }),
  unregister: (root) => Effect.asVoid(Effect.promise(() => forgetRegistered(root))),
};
