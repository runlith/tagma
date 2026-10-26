import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { makeWatchClient } from '@runlith/watch/client';
import { watch } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { type TreeShift, type TreeWatch, type WatchEvent, watchAll, watchReading, watchTree, withholding } from './tree.js';
import { watchTickets } from './tickets.js';
import { FileWatcher, type WatchHearing, WatchRefused, WatchTickets } from '../contract/service/watch.js';

const WATCH_ROWS_ALL = 10_000;

const arrival = () => {
  const pending = Promise.withResolvers<void>();
  const timer = setTimeout(() => pending.reject(new Error('the watcher did not deliver its event')), 8_000);
  return { promise: pending.promise.finally(() => clearTimeout(timer)), resolve: () => pending.resolve() };
};

const delivering = (delivered: { readonly promise: Promise<void> }, write: () => Promise<void>) =>
  Effect.promise(async () => {
    let arrived = false;
    const waiting = delivered.promise.finally(() => {
      arrived = true;
    });
    while (!arrived) {
      await write();
      await Promise.race([waiting, Bun.sleep(50)]);
    }
    await waiting;
  });

const home = Effect.fnUntraced(function* (prefix: string) {
  const files = yield* FileSystem.FileSystem;
  return yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix }));
});

const following = (effect: Effect.Effect<TreeWatch>) => Effect.acquireRelease(effect, (watcher) => Effect.sync(() => watcher.close()));

const refused = (failure: { readonly message: string }) => new WatchRefused({ message: failure.message });

class WatchSocket extends Context.Service<WatchSocket, { readonly path: string }>()('test/WatchSocket') {}

const watcherProcess = Layer.effectContext(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const path = yield* files.makeTempDirectoryScoped({ prefix: 'watch-tree-' });
    const client = yield* makeWatchClient({ dir: path, lifetime: 'with-client' });
    return Context.make(
      FileWatcher,
      FileWatcher.of({
        subscribe: (at, options, hearing) => Effect.mapError(client.subscribe(at, options, hearing), refused),
        mark: (at, file, ignore, lasting) => Effect.mapError(client.mark(at, file, ignore, lasting), refused),
        settle: (at, ignore) => Effect.mapError(client.settle(at, ignore), refused),
        changedSince: (at, position, ignore) => Effect.mapError(client.changedSince(at, position, ignore), refused),
        marking: client.marking,
        heardLateMs: 0,
      }),
    ).pipe(Context.add(WatchSocket, { path }));
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));

const withheldWorld = Effect.fnUntraced(function* () {
  const root = yield* home('watch-withheld-');
  const tree = join(root, 'tree');
  yield* Effect.promise(() => mkdir(join(tree, 'deep'), { recursive: true }));
  const tickets = watchTickets(8);
  const watched = (at: string, heard: WatchEvent[]) =>
    following(
      Effect.provideService(
        watchAll([{ at, recursive: true, required: true, listen: (event) => heard.push(event) }]),
        WatchTickets,
        tickets,
      ),
    );
  return { tree, tickets, watched };
});

const git = (cwd: string, ...args: string[]) =>
  Effect.promise(async () => {
    const ran = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' });
    if ((await ran.exited) !== 0) throw new Error(`git ${args.join(' ')}: ${await new Response(ran.stderr).text()}`);
  });

layer(watcherProcess, { excludeTestServices: true })('tree watching', (it) => {
  it.effect('opening and closing a place on one root gives a place on another root no rescan', () =>
    Effect.gen(function* () {
      const a = yield* home('watch-root-a-');
      const b = yield* home('watch-root-b-');
      const heard = yield* Queue.unbounded<WatchEvent>();
      yield* following(watchAll([{ at: a, recursive: true, listen: (event) => Queue.offerUnsafe(heard, event) }]));
      for (let round = 0; round < 3; round += 1) {
        const other = yield* watchAll([{ at: b, recursive: true, listen: () => undefined }]);
        expect(other.watching()).toBe(true);
        other.close();
      }
      yield* Effect.promise(() => writeFile(join(a, 'marker'), 'x'));
      const seen: WatchEvent[] = [];
      while (!seen.some((event) => event.paths?.includes('marker'))) seen.push(yield* Queue.take(heard));
      expect(seen.filter((event) => 'rescan' in event && event.rescan !== 'rename')).toEqual([]);
    }),
  );

  it.effect('a lost watch process tells its places of an error, and a place opened again hears writes', () =>
    Effect.gen(function* () {
      const root = yield* home('watch-killed-');
      const heard = yield* Queue.unbounded<WatchEvent>();
      const first = yield* following(watchAll([{ at: root, recursive: true, listen: (event) => Queue.offerUnsafe(heard, event) }]));
      const socket = yield* WatchSocket;
      yield* Effect.promise(async () => {
        if (Bun.spawnSync(['pkill', '-KILL', '-f', socket.path]).exitCode !== 0) throw new Error('no watch process to kill');
      });
      expect(yield* Queue.take(heard)).toEqual({ rescan: 'error' });
      expect(first.watching()).toBe(false);
      const again = yield* Queue.unbounded<WatchEvent>();
      const second = yield* following(watchAll([{ at: root, recursive: true, listen: (event) => Queue.offerUnsafe(again, event) }]));
      expect(second.watching()).toBe(true);
      yield* Effect.promise(() => writeFile(join(root, 'after'), 'x'));
      let named = false;
      while (!named) named = (yield* Queue.take(again)).paths?.includes('after') === true;
    }),
  );

  it.effect('a git tree keeps what git ignores out of its events, and moved ignore rules reopen it with a rescan', () =>
    Effect.gen(function* () {
      const tree = yield* home('watch-ignored-');
      yield* git(tree, 'init', '-q');
      yield* Effect.promise(async () => {
        await writeFile(join(tree, '.gitignore'), 'skipped/\n');
        await mkdir(join(tree, 'skipped'));
        await mkdir(join(tree, 'later'));
        await writeFile(join(tree, 'later', 'kept'), 'x');
      });
      const heard = yield* Queue.unbounded<TreeShift>();
      yield* following(
        watchTree({ tree, gitDir: join(tree, '.git'), commonDir: join(tree, '.git') }, (shift) => Queue.offerUnsafe(heard, shift)),
      );
      const until = Effect.fnUntraced(function* (wanted: (shift: TreeShift) => boolean) {
        const seen: TreeShift[] = [];
        while (!seen.some(wanted)) seen.push(yield* Queue.take(heard));
        return seen;
      });
      yield* Effect.promise(async () => {
        await writeFile(join(tree, 'skipped', 'quiet'), 'x');
        await writeFile(join(tree, 'loud'), 'x');
      });
      const first = yield* until((shift) => shift.paths?.includes('loud') === true);
      expect(first.flatMap((shift) => shift.paths ?? []).filter((path) => path.startsWith('skipped'))).toEqual([]);
      yield* Effect.promise(() => writeFile(join(tree, '.gitignore'), 'skipped/\nlater/\n'));
      yield* until((shift) => shift.movement === 'tree' && 'rescan' in shift && shift.rescan === 'unnamed');
      yield* Effect.promise(async () => {
        await writeFile(join(tree, 'later', 'quiet'), 'x');
        await writeFile(join(tree, 'louder'), 'x');
      });
      const second = yield* until((shift) => shift.paths?.includes('louder') === true);
      expect(second.flatMap((shift) => shift.paths ?? []).filter((path) => path.startsWith('later'))).toEqual([]);
    }),
  );

  it.effect('a directory git ignores that appears after the tree opened is kept out without a change of ignore rules', () =>
    Effect.gen(function* () {
      const tree = yield* home('watch-fresh-ignored-');
      yield* git(tree, 'init', '-q');
      yield* Effect.promise(() => writeFile(join(tree, '.gitignore'), 'node_modules/\n'));
      const heard = yield* Queue.unbounded<TreeShift>();
      yield* following(
        watchTree({ tree, gitDir: join(tree, '.git'), commonDir: join(tree, '.git') }, (shift) => Queue.offerUnsafe(heard, shift)),
      );
      const until = Effect.fnUntraced(function* (wanted: (shift: TreeShift) => boolean) {
        const seen: TreeShift[] = [];
        while (!seen.some(wanted)) seen.push(yield* Queue.take(heard));
        return seen;
      });
      const installed = join(tree, 'package', 'node_modules');
      yield* Effect.promise(() => mkdir(join(installed, 'first'), { recursive: true }));
      yield* until((shift) => shift.movement === 'tree' && 'rescan' in shift && shift.rescan === 'unnamed');
      yield* Effect.promise(async () => {
        await writeFile(join(installed, 'first', 'quiet'), 'x');
        await writeFile(join(installed, 'later'), 'x');
        await writeFile(join(tree, 'loud'), 'x');
      });
      const after = yield* until((shift) => shift.paths?.includes('loud') === true);
      expect(after.flatMap((shift) => shift.paths ?? []).filter((path) => path.includes('node_modules'))).toEqual([]);
    }),
  );

  it.effect('a withheld tree holds no watcher handle while its work runs, and watchers whose tree went with it hear it lost', () =>
    Effect.gen(function* () {
      const { tree, tickets, watched } = yield* withheldWorld();
      const standingHeard: WatchEvent[] = [];
      const latecomerHeard: WatchEvent[] = [];
      const standing = yield* watched(tree, standingHeard);
      const during = yield* withholding(
        [tree],
        Effect.gen(function* () {
          const latecomer = yield* watched(join(tree, 'deep'), latecomerHeard);
          const seen = { handles: tickets.standing().active, standing: standing.watching(), latecomer: latecomer.watching() };
          yield* Effect.promise(() => rm(tree, { recursive: true }));
          return seen;
        }),
      );
      expect(during).toEqual({ handles: 0, standing: false, latecomer: false });
      expect([standingHeard, latecomerHeard]).toEqual([[{ rescan: 'lost' }], [{ rescan: 'lost' }]]);
    }),
  );

  it.effect('a withheld tree that outlives its work is watched again, and its watcher is told to rescan what it missed', () =>
    Effect.gen(function* () {
      const { tree, tickets, watched } = yield* withheldWorld();
      const heard: WatchEvent[] = [];
      const standing = yield* watched(tree, heard);
      yield* withholding([tree], Effect.void);
      expect({ watching: standing.watching(), handles: tickets.standing().active, heard }).toEqual({
        watching: true,
        handles: 1,
        heard: [{ rescan: 'unnamed' }],
      });
    }),
  );

  it.effect('the watch reading names each watched place with its state and counts the rescans it delivered', () =>
    Effect.gen(function* () {
      const { tree, watched } = yield* withheldWorld();
      yield* watched(tree, []);
      const mine = () => watchReading(WATCH_ROWS_ALL).places.filter((place) => place.at === tree);
      const during = yield* withholding([tree], Effect.sync(mine));
      expect(during).toMatchObject([{ recursive: true, state: 'parked', rescans: { unnamed: 0 } }]);
      expect(mine()).toMatchObject([{ recursive: true, state: 'watching', rescans: { unnamed: 1 } }]);
    }),
  );

  it.effect('a worktree observes atomic config and exclude replacements without treating unrelated git files as either', () =>
    Effect.gen(function* () {
      const root = yield* home('watch-git-files-');
      const tree = join(root, 'checkout');
      const commonDir = join(root, 'common');
      const info = join(commonDir, 'info');
      yield* Effect.promise(async () => {
        await mkdir(tree);
        await mkdir(info, { recursive: true });
      });
      const raw = new Set<string>();
      const heard: TreeShift[] = [];
      let delivered = arrival();
      const complete = () => {
        if (
          raw.has('index') &&
          raw.has('info/attributes') &&
          heard.some((event) => event.movement === 'config' && event.paths?.includes('config')) &&
          heard.some((event) => event.movement === 'ignore' && event.paths?.includes('info/exclude'))
        ) {
          delivered.resolve();
        }
      };
      for (const [at, prefix] of [
        [commonDir, ''],
        [info, 'info/'],
      ] as const) {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            watch(at, { persistent: false }, (_kind, file) => {
              if (file !== null) raw.add(`${prefix}${file}`);
              complete();
            }),
          ),
          (observer) => Effect.sync(() => observer.close()),
        );
      }
      const tracked = yield* following(
        watchTree({ tree, commonDir, gitDir: null }, (event) => {
          heard.push(event);
          complete();
        }),
      );
      expect(tracked.watching()).toBe(true);
      for (const body of ['first\n', 'second\n']) {
        yield* delivering(delivered, async () => {
          await writeFile(join(commonDir, 'index'), 'unrelated\n');
          await writeFile(join(info, 'attributes'), 'unrelated\n');
          await writeFile(join(commonDir, 'config.next'), body);
          await rename(join(commonDir, 'config.next'), join(commonDir, 'config'));
          await writeFile(join(info, 'exclude.next'), body);
          await rename(join(info, 'exclude.next'), join(info, 'exclude'));
        });
        const named = heard.filter((event) => event.paths !== undefined || ('rescan' in event && event.rescan === 'rename'));
        expect(
          named.filter((event) => event.movement === 'config').every((event) => event.paths?.every((path) => path === 'config') === true),
        ).toBe(true);
        expect(
          named
            .filter((event) => event.movement === 'ignore')
            .every((event) => event.paths?.every((path) => path === 'info/exclude') === true),
        ).toBe(true);
        heard.length = 0;
        delivered = arrival();
      }
      delivered.resolve();
    }),
  );

  it.effect('a linked worktree keeps observing repeated atomic index replacements and shared loose and packed refs', () =>
    Effect.gen(function* () {
      const root = yield* home('watch-git-metadata-');
      const tree = join(root, 'checkout');
      const gitDir = join(root, 'git');
      const commonDir = join(root, 'common');
      yield* Effect.promise(async () => {
        await mkdir(tree);
        await mkdir(gitDir);
        await mkdir(join(commonDir, 'refs', 'heads'), { recursive: true });
      });
      let expected = (event: TreeShift): boolean => event.movement === 'index';
      let delivered = arrival();
      const heard: TreeShift[] = [];
      const tracked = yield* following(
        watchTree({ tree, commonDir, gitDir }, (event) => {
          heard.push(event);
          if (expected(event)) delivered.resolve();
        }),
      );
      expect(tracked.watching()).toBe(true);
      for (const body of ['first\n', 'second\n']) {
        yield* delivering(delivered, async () => {
          await writeFile(join(gitDir, 'index.next'), body);
          await rename(join(gitDir, 'index.next'), join(gitDir, 'index'));
        });
        expect(heard.filter((event) => event.movement === 'index').every((event) => event.paths?.includes('index'))).toBe(true);
        heard.length = 0;
        delivered = arrival();
      }
      expected = (event) => event.movement === 'refs';
      yield* delivering(delivered, async () => {
        await writeFile(join(commonDir, 'refs', 'heads', 'main.lock'), 'loose\n');
        await rename(join(commonDir, 'refs', 'heads', 'main.lock'), join(commonDir, 'refs', 'heads', 'main'));
      });
      expect(heard.some((event) => event.movement === 'refs')).toBe(true);
      expect(
        heard.filter((event) => event.movement === 'refs').every((event) => event.paths?.every((path) => !path.endsWith('.lock'))),
      ).toBe(true);
      heard.length = 0;
      expected = (event) => event.movement === 'refs' && event.paths?.includes('packed-refs') === true;
      delivered = arrival();
      yield* delivering(delivered, async () => {
        await writeFile(join(commonDir, 'packed-refs.next'), 'packed\n');
        await rename(join(commonDir, 'packed-refs.next'), join(commonDir, 'packed-refs'));
      });
      expect(heard.some((event) => event.movement === 'refs' && event.paths?.includes('packed-refs'))).toBe(true);
    }),
  );
});

const doubled = (hearings: Map<string, WatchHearing>) =>
  Context.make(
    FileWatcher,
    FileWatcher.of({
      subscribe: (at, _options, hearing) =>
        Effect.sync(() => {
          hearings.set(at, hearing);
          return { close: Effect.sync(() => void hearings.delete(at)) };
        }),
      mark: () => Effect.die('the double marks no position'),
      settle: () => Effect.die('the double settles no delivery'),
      changedSince: () => Effect.die('the double reads no journal'),
      marking: 'refresh',
      heardLateMs: 0,
    }),
  );

layer(BunFileSystem.layer, { excludeTestServices: true })('subscription faults', (it) => {
  it.effect('a subscription that dropped events tells only its own places to rescan', () =>
    Effect.gen(function* () {
      const a = yield* home('watch-dropped-a-');
      const b = yield* home('watch-dropped-b-');
      const hearings = new Map<string, WatchHearing>();
      const heardA: WatchEvent[] = [];
      const heardB: WatchEvent[] = [];
      const watcher = doubled(hearings);
      yield* following(watchAll([{ at: a, recursive: true, listen: (event) => heardA.push(event) }])).pipe(Effect.provide(watcher));
      yield* following(watchAll([{ at: b, recursive: true, listen: (event) => heardB.push(event) }])).pipe(Effect.provide(watcher));
      hearings.get(a)?.dropped('Too many events. File system must be re-scanned.', null);
      expect({ heardA, heardB }).toEqual({ heardA: [{ rescan: 'unnamed' }], heardB: [] });
    }),
  );

  it.effect('a git tree hears a dropped git subtree as its marks moved, and a dropped working subtree reads the ignore rules again', () =>
    Effect.gen(function* () {
      const tree = yield* home('watch-dropped-git-');
      yield* git(tree, 'init', '-q');
      yield* Effect.promise(async () => {
        await writeFile(join(tree, '.gitignore'), 'skipped/\n');
        await mkdir(join(tree, 'skipped'));
      });
      const hearings = new Map<string, WatchHearing>();
      const heard = yield* Queue.unbounded<TreeShift>();
      yield* following(
        watchTree({ tree, gitDir: join(tree, '.git'), commonDir: join(tree, '.git') }, (shift) => Queue.offerUnsafe(heard, shift)),
      ).pipe(Effect.provide(doubled(hearings)));
      hearings.get(tree)?.dropped('Events were dropped by the kernel.', '.git/refs');
      yield* Effect.promise(() => writeFile(join(tree, '.gitignore'), ''));
      hearings.get(tree)?.dropped('Events were dropped by the kernel.', 'skipped');
      const seen: TreeShift[] = [];
      while (!seen.some((shift) => 'rescan' in shift && shift.rescan === 'unnamed')) seen.push(yield* Queue.take(heard));
      expect(seen.some((shift) => shift.movement === 'refs')).toBe(true);
    }),
  );
});
