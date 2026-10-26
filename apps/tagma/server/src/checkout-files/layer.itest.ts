import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { Intake } from '../change-record/contract/service/intake.js';
import { Capacity, heavyPool, serverCapacity, thisMachine } from '../platform/contract/service/capacity.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch } from '../workspace/contract/service/watch.js';
import { Renames } from './contract/service/renames.js';
import { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { checkoutFilesServingLayer } from './layer.js';
import { GRAPH, filesWorld, worldLayers } from './testing/world.js';
import { makeTrashActs } from './trash/place.js';
import { RETENTION_MS, sweptTrash } from './trash/sweep.js';

it.live('the trash collector leaves alone an act that a deletion or restore holds, however old', () =>
  Effect.gen(function* () {
    const world = yield* filesWorld;
    const trash = world.paths.join(world.root, '.git', 'tagma', 'trash');
    const home = world.paths.join(trash, 'old-00000000');
    yield* world.files.makeDirectory(world.paths.join(home, 'entries'), { recursive: true });
    yield* world.files.writeFileString(world.paths.join(home, 'manifest.json'), JSON.stringify({ at: 0, entries: [], files: [] }));
    const acts = makeTrashActs();

    yield* acts.holding(home, sweptTrash(trash, yield* Clock.currentTimeMillis, acts));
    expect(yield* world.files.exists(home)).toBe(true);
    yield* sweptTrash(trash, yield* Clock.currentTimeMillis, acts);
    expect(yield* world.files.exists(home)).toBe(false);
  }).pipe(Effect.provide(worldLayers)),
);

it.live('the trash collector runs when the server opens: an act past its week is emptied and a newer one is kept', () =>
  Effect.gen(function* () {
    const world = yield* filesWorld;
    const trash = world.paths.join(world.root, '.git', 'tagma', 'trash');
    const act = Effect.fnUntraced(function* (id: string, at: number) {
      yield* world.files.makeDirectory(world.paths.join(trash, id, 'entries'), { recursive: true });
      yield* world.files.writeFileString(world.paths.join(trash, id, 'manifest.json'), JSON.stringify({ at, entries: [], files: [] }));
    });
    yield* act('old-00000000', (yield* Clock.currentTimeMillis) - RETENTION_MS - 60_000);
    yield* act('new-00000000', yield* Clock.currentTimeMillis);
    const opened = yield* Deferred.make<void>();
    yield* Layer.build(
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
            Layer.succeed(Maintenance, { opened: Deferred.await(opened), isOpen: Deferred.isDone(opened) }),
            Layer.succeed(Capacity, serverCapacity([heavyPool(thisMachine())])),
          ),
        ),
      ),
    );
    const old = world.paths.join(trash, 'old-00000000');
    expect(yield* world.files.exists(old)).toBe(true);

    yield* Deferred.succeed(opened, undefined);
    for (let waited = 0; (yield* world.files.exists(old)) && waited < 5_000; waited += 25) yield* Effect.sleep('25 millis');
    expect(yield* world.files.exists(old)).toBe(false);
    expect(yield* world.files.exists(world.paths.join(trash, 'new-00000000'))).toBe(true);
  }).pipe(Effect.provide(worldLayers)),
);
