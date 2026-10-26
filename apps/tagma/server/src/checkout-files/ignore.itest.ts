import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { Git } from '@runlith/git/Git';
import { Intake } from '../change-record/contract/service/intake.js';
import { Capacity, heavyPool, serverCapacity, thisMachine } from '../platform/contract/service/capacity.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch } from '../workspace/contract/service/watch.js';
import { Directories } from './contract/service/directories.js';
import { PathIndex } from './contract/service/pathIndex.js';
import { Renames } from './contract/service/renames.js';
import { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { checkoutFilesServingLayer } from './layer.js';
import { GRAPH, filesWorld, worldLayers } from './testing/world.js';

class UserIgnore extends Context.Service<UserIgnore, { readonly path: string }>()('test/UserIgnore') {}

const configuration = Layer.effect(
  UserIgnore,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'checkout-user-ignore-' });
    const config = `${home}/gitconfig`;
    const path = `${home}/ignore`;
    yield* files.writeFileString(path, 'b.txt\n');
    yield* files.writeFileString(config, `[core]\n\texcludesFile = ${JSON.stringify(path)}\n`);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const before = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
        process.env.GIT_CONFIG_GLOBAL = config;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        return before;
      }),
      (before) =>
        Effect.sync(() => {
          if (before.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
          else process.env.GIT_CONFIG_GLOBAL = before.global;
          if (before.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
          else process.env.GIT_CONFIG_NOSYSTEM = before.system;
        }),
    );
    return UserIgnore.of({ path });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(worldLayers.pipe(Layer.provideMerge(configuration)), { excludeTestServices: true })('user ignore rules', (it) => {
  it.effect('the served directory and path index use the user excludes file, and its edits change find results', () =>
    Effect.gen(function* () {
      const world = yield* filesWorld;
      const ignore = yield* UserIgnore;
      yield* world.write('a.txt', 'x');
      yield* world.write('b.txt', 'x');
      const services = yield* Layer.build(
        checkoutFilesServingLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Git, world.git),
              Layer.succeed(CheckoutPaths, world.checkoutPaths),
              Layer.succeed(CheckoutWatch, world.watch),
              Layer.succeed(GraphDirectory, GRAPH),
              Layer.succeed(RipgrepBinary, { path: () => Effect.die('no search runs here') }),
              Layer.succeed(Intake, { turn: () => Effect.die('no write runs here'), land: () => Effect.die('no write runs here') }),
              Layer.succeed(Renames, { movedTo: () => Effect.succeed(null) }),
              Layer.succeed(FileRoots, world.roots),
              Layer.succeed(Maintenance, { opened: Effect.never, isOpen: Effect.succeed(false) }),
              Layer.succeed(Capacity, serverCapacity([heavyPool(thisMachine())])),
            ),
          ),
        ),
      );
      const directories = Context.get(services, Directories);
      const listed = yield* directories.list(world.place, { path: '', ignored: false, rows: 10, cursor: undefined });
      expect(listed.rows.map((entry) => [entry.name, entry.ignored])).toEqual([
        ['a.txt', false],
        ['b.txt', true],
      ]);
      const index = Context.get(services, PathIndex);
      const ask = Effect.map(index.find(world.place, { query: 'txt', limit: 10, recent: [] }), (found) =>
        found.files.map((file) => file.path),
      );
      expect(yield* ask).toEqual(['a.txt']);
      yield* world.files.writeFileString(ignore.path, 'a.txt\n');
      const updated = yield* ask.pipe(
        Effect.flatMap((paths) => (paths.length === 1 && paths[0] === 'b.txt' ? Effect.succeed(paths) : Effect.fail('not yet' as const))),
        Effect.retry({ schedule: Schedule.spaced('50 millis'), times: 100 }),
      );
      expect(updated).toEqual(['b.txt']);
    }),
  );
});
