import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { kind, world } from '@runlith/testbed/worlds';
import { Context, Deferred, Effect, Layer } from 'effect';
import { build, stop } from 'esbuild';
import { Hosts } from '../../browser/contract/service/hosts.js';
import { absentAdapter, browserWorld, type BrowserFixture } from '../../browser/testing/world.js';
import { desktopAdapter } from '../adapter.js';
import { DESKTOP } from '../contract/wire/channel.js';
import { ServedChannel, servedChannel } from './served.js';

class DesktopBrowser extends Context.Service<DesktopBrowser, BrowserFixture>()('testing/DesktopBrowser') {}

const desktopWorld = kind(DesktopBrowser, (_params: null, home) =>
  Layer.build(browserWorld({ home, adapters: [desktopAdapter, absentAdapter(desktopAdapter)], host: Layer.empty })).pipe(
    Effect.map((services) => ({ home, services })),
    Effect.orDie,
  ),
);

export const desktopFixture = () =>
  Layer.unwrap(
    Effect.map(DesktopBrowser, ({ home, services }) =>
      electronHost(home).pipe(Layer.provide(servedChannel), Layer.provideMerge(Layer.succeedContext(services))),
    ),
  ).pipe(Layer.provide(world(desktopWorld, null)));

const ENTRY = fileURLToPath(new URL('../../../../desktop/src/browser/testing/host.ts', import.meta.url));
const SERVER_ENV = 'TAGMA_TEST_BROWSER_SERVER';
const DATA_ENV = 'TAGMA_TEST_BROWSER_DATA';

export type Command = { readonly show: string } | { readonly reload: true } | { readonly nativeProbe: string };

export type Electron = {
  readonly control: (command: Command) => Effect.Effect<void>;
  readonly exited: Effect.Effect<string>;
};

const electronBinary = (): string => createRequire(import.meta.url)('electron') as string;

const bundled = (into: string) =>
  Effect.promise(async () => {
    const outfile = join(into, 'host.mjs');
    await build({
      bundle: true,
      entryPoints: [ENTRY],
      external: ['electron'],
      format: 'esm',
      outfile,
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    }).finally(stop);
    return outfile;
  });

export const launchElectron = Effect.fnUntraced(function* (home: string, url: URL) {
  const folder = join(home, 'desktop');
  mkdirSync(folder, { recursive: true });
  const bundle = yield* bundled(folder);
  const env: Record<string, string | undefined> = { ...process.env, [SERVER_ENV]: url.toString(), [DATA_ENV]: join(folder, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const exited = yield* Deferred.make<string>();
  const acknowledged = new Map<number, Deferred.Deferred<void>>();
  let asked = 0;
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const launched = spawn(electronBinary(), [bundle], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let said = '';
      launched.stderr.on('data', (chunk: Buffer) => {
        said = `${said}${chunk.toString()}`.slice(-8_000);
      });
      createInterface({ input: launched.stdout }).on('line', (line) => {
        const done = /^\{"done":(\d+)\}$/u.exec(line);
        if (done === null) said = `${said}${line}\n`.slice(-8_000);
        else Deferred.doneUnsafe(acknowledged.get(Number(done[1]))!, Effect.void);
      });
      launched.on('exit', (code, signal) =>
        Deferred.doneUnsafe(exited, Effect.succeed(`the Electron host left with ${signal ?? code}:\n${said}`)),
      );
      return launched;
    }),
    (launched) =>
      Effect.callback<void>((resume) => {
        if (launched.exitCode !== null || launched.signalCode !== null) return resume(Effect.void);
        launched.once('exit', () => resume(Effect.void));
        launched.kill('SIGTERM');
      }),
  );
  const control = (command: Command) =>
    Effect.suspend(() => {
      const id = ++asked;
      const done = Deferred.makeUnsafe<void>();
      acknowledged.set(id, done);
      child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
      return Deferred.await(done);
    });
  return { control, exited: Deferred.await(exited) } satisfies Electron;
});

export const electronHost = (home: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { url } = yield* ServedChannel;
      const hosts = yield* Hosts;
      const attached = yield* Deferred.make<void>();
      yield* hosts.watch({
        attached: (host) => (host.adapter === DESKTOP ? Effect.asVoid(Deferred.succeed(attached, undefined)) : Effect.void),
        detached: () => Effect.void,
      });
      const electron = yield* launchElectron(home, url);
      yield* Effect.raceFirst(Deferred.await(attached), Effect.flatMap(electron.exited, Effect.die));
      yield* Effect.forkScoped(Effect.flatMap(electron.exited, (said) => Effect.logError(said)));
    }),
  );
