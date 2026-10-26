import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Path, Scope, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { fixtureMigrations } from './migrations.js';
import { checkoutWatches, fileRootStore, rootRegistry } from '../../workspace/testing/doubles.js';
import { SourceChanges } from '../../checkout-builds/contract/service/changes.js';
import { checkoutBuildsLayer } from '../../checkout-builds/runner.js';
import { NextInstallation } from '../../installation/contract/service/next.js';
import type { NextFrame } from '../../installation/contract/wire/next.js';
import { sourceChanges } from '../developer/sourceChanges.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)));

layer(layers, { excludeTestServices: true, testTimeout: 30_000, timeout: 60_000 })('installation source', (it) => {
  it.effect(
    'the installation source receives actual file and HEAD changes through the shared checkout watcher',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const git = yield* Git;
        const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'installation-source-' }));
        const checkout = join(home, 'checkout');
        yield* files.makeDirectory(checkout);
        yield* files.writeFileString(join(checkout, 'package.json'), JSON.stringify({ scripts: { 'tagma:build': 'true' } }));
        const run = (...args: string[]) => Effect.orDie(git.run(args, { cwd: checkout }));
        yield* run('init', '-q');
        yield* run('add', '.');
        yield* run('commit', '-qm', 'first');
        const records = yield* fileRootStore((yield* MachineStore).db, yield* MachineUnits);
        const roots = yield* rootRegistry(records, files, yield* Path.Path, NamespaceId.make('source'), {
          holding: () => Effect.succeed(new Map()),
        });
        const watch = yield* checkoutWatches(git, roots, yield* Scope.Scope);
        const builds = Context.get(
          yield* Layer.build(
            checkoutBuildsLayer({
              checkout,
              log: join(home, 'build.log'),
              worktrees: join(home, 'build'),
            }).pipe(Layer.provide(Layer.succeed(SourceChanges, sourceChanges(roots, watch)))),
          ),
          NextInstallation,
        );
        const offered = (frame: NextFrame, id: string) => frame.offers.find((offer) => offer.id === id);
        yield* Effect.forkScoped(Stream.runDrain(builds.changes));
        const initial = yield* Stream.runHead(builds.changes).pipe(Effect.timeout('3 seconds'));
        expect(initial._tag === 'Some' && offered(initial.value, 'tree')?.label).toBe('');

        yield* files.writeFileString(join(checkout, 'new.txt'), 'new');
        const edited = yield* Stream.runHead(Stream.filter(builds.changes, (frame) => offered(frame, 'tree')?.label === '+1 file')).pipe(
          Effect.timeout('3 seconds'),
        );
        expect(edited._tag === 'Some' && offered(edited.value, 'tree')?.disabled).toBeNull();

        yield* run('add', '.');
        yield* run('commit', '-qm', 'second');
        const committed = yield* Stream.runHead(
          Stream.filter(builds.changes, (frame) => offered(frame, 'head')?.detail === 'second' && offered(frame, 'tree')?.label === ''),
        ).pipe(Effect.timeout('3 seconds'));
        expect(committed._tag === 'Some' && committed.value.revision).toBeGreaterThan(initial._tag === 'Some' ? initial.value.revision : 0);
        expect(offered(yield* builds.reading, 'head')?.detail).toBe('second');
      }).pipe(Effect.timeout('8 seconds')),
    10_000,
  );
});
