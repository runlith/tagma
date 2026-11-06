import { expect } from 'bun:test';
import { basename, join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { HttpClient } from 'effect/http';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import type { FreshHost, FreshProcess } from './contract/service/host.js';
import { FreshWorld } from './contract/service/world.js';
import { freshWorldLayer } from './lifecycle.js';

const HOME = '/home';
const DATA = '/data';
const ROOT = join(HOME, '.tagma-fresh');
const PLACED = join(ROOT, 'home', 'Applications', 'Tagma.app');
const KEPT = join(DATA, 'fresh', 'releases', '0.2.2', 'Tagma.app');

const unread = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die('the feed is not read in this scenario')),
);

const machine = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const said: string[] = [];
  const versions = new Map<string, string>();
  let living: FreshProcess[] = [];
  const host: FreshHost = {
    platform: Effect.succeed({ os: 'darwin', arch: 'arm64' }),
    image: () => Effect.die('no image in this scenario'),
    place: Effect.fnUntraced(function* (bundle: string, into: string) {
      const target = join(into, basename(bundle));
      yield* Effect.orDie(files.makeDirectory(target, { recursive: true }));
      versions.set(target, bundle === KEPT ? '0.2.2' : '0.2.1');
      said.push(`place ${bundle}`);
      return target;
    }),
    version: (bundle) => Effect.succeed(versions.get(bundle) ?? '0.2.1'),
    keychain: () => Effect.void,
    launch: (bundle, _place, running) =>
      Effect.sync(() => {
        said.push(`launch ${running ? 'forward' : 'new'}`);
        if (!running) living = [{ pid: 7, executable: join(bundle, 'Contents', 'MacOS', 'Tagma') }];
      }),
    processes: () => Effect.sync(() => living),
    signal: (pids, signal) =>
      Effect.sync(() => {
        said.push(`${signal} ${pids.join(',')}`);
        living = living.filter((one) => !pids.includes(one.pid));
      }),
    quit: () =>
      Effect.sync(() => {
        said.push('quit');
        living = living.filter((one) => one.pid === 9);
        return null;
      }),
    window: (bundle) => `${join(bundle, 'Contents', 'MacOS')}/`,
    forget: () =>
      Effect.flatMap(Effect.orDie(files.exists(ROOT)), (standing) =>
        Effect.sync(() => said.push(`forget with root ${standing ? 'standing' : 'gone'}`)),
      ),
    unregister: () =>
      Effect.flatMap(Effect.orDie(files.exists(ROOT)), (standing) =>
        Effect.sync(() => said.push(`unregister with root ${standing ? 'standing' : 'gone'}`)),
      ),
  };
  const world = yield* Effect.gen(function* () {
    return yield* FreshWorld;
  }).pipe(
    Effect.provide(
      freshWorldLayer({ home: HOME, data: DATA, feed: null, url: 'http://127.0.0.1:5643', host }).pipe(
        Layer.provide(Layer.merge(unread, Layer.succeed(FileSystem.FileSystem, files))),
      ),
    ),
  );
  return { files, said, world, running: (pids: FreshProcess[]) => (living = pids) };
});

it.effect('starting over ends every process of the world before macOS forgets it, then opens the kept release on a first launch', () =>
  Effect.gen(function* () {
    const { files, said, world, running } = yield* machine;
    yield* Effect.orDie(files.makeDirectory(PLACED, { recursive: true }));
    yield* Effect.orDie(files.makeDirectory(KEPT, { recursive: true }));
    running([
      { pid: 7, executable: join(PLACED, 'Contents', 'MacOS', 'Tagma') },
      { pid: 8, executable: join(ROOT, 'home', '.tagma', 'bun') },
      { pid: 9, executable: join(ROOT, 'home', '.tagma', 'executions', 'holder') },
    ]);

    const opened = yield* world.open({ over: false, release: '0.2.2', from: null });

    expect(said).toEqual([
      'SIGTERM 7',
      'quit',
      'SIGKILL 9',
      'forget with root standing',
      'unregister with root gone',
      `place ${KEPT}`,
      'launch new',
    ]);
    expect(opened).toEqual({ root: ROOT, release: '0.2.2', running: true, url: 'http://127.0.0.1:5643', started: true });
  }).pipe(Effect.provide(Memory.layer)),
);

it.effect('opening a closed world launches it again as it stands, and a running one is only brought forward', () =>
  Effect.gen(function* () {
    const { files, said, world } = yield* machine;
    yield* Effect.orDie(files.makeDirectory(PLACED, { recursive: true }));

    const first = yield* world.open({ over: false, release: null, from: null });
    const second = yield* world.open({ over: false, release: null, from: null });

    expect(said).toEqual(['launch new', 'launch forward']);
    expect([first.started, second.started]).toEqual([true, false]);
    expect(yield* world.read).toEqual({ root: ROOT, release: '0.2.1', running: true, url: 'http://127.0.0.1:5643' });
  }).pipe(Effect.provide(Memory.layer)),
);

it.effect('with no world, no kept release and no feed the act refuses before it stops or places anything', () =>
  Effect.gen(function* () {
    const { said, world } = yield* machine;

    const refused = yield* Effect.flip(world.open({ over: false, release: null, from: null }));

    expect(refused.code).toBe('fresh-no-feed');
    expect(said).toEqual([]);
  }).pipe(Effect.provide(Memory.layer)),
);
