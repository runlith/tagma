import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, FileSystem, Layer, Path, Queue, Scope, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { resolveRipgrepPath } from '@runlith/ripgrep';
import { workingAt } from '@runlith/files/working';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { FileRoot } from '../../workspace/contract/wire/roots.js';
import { checkoutWatches, fixedCheckoutPaths } from '../../workspace/testing/doubles.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { CheckoutWatch } from '../../workspace/contract/service/watch.js';
import { Renames } from '../contract/service/renames.js';
import { RipgrepBinary } from '../../platform/contract/service/ripgrep.js';
import { makeTargets } from '../tree/target.js';
import { makeDirectoryListing } from '../listing/directory.js';
import { makePathIndexes } from '../finding/indexes.js';
import { makeFolderWatches } from '../documents/folders.js';
import { makeOpenDocuments } from '../documents/open.js';
import { makeContentSearches } from '../search/content.js';
import { makeFilesWorker } from '../worker/client.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const layers = Layer.mergeAll(BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)), host, watchProcessLayer);

export const GRAPH = '.tagma';

const unrenamed: Renames['Service'] = { movedTo: () => Effect.succeed(null) };

export const worldLayers = layers;

export const filesWorld = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const real = yield* Git;
  const spawned: (readonly string[])[] = [];
  const git: Git['Service'] = {
    run: (args, options) => {
      spawned.push(args);
      return real.run(args, options);
    },
    objects: real.objects,
  };
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'checkout-files-' }));
  const root = paths.join(home, 'checkout');
  yield* files.makeDirectory(root, { recursive: true });
  const run = (args: readonly string[]) => Effect.orDie(real.run(args, { cwd: root }));
  yield* run(['init', '-q', '-b', 'main']);
  const registered: FileRoot = {
    rootId: RootId.make('test-files-root'),
    namespaceId: NamespaceId.make('test-files'),
    path: root,
    locationRevision: LocationRevision.make(0),
    witness: { provider: 'test', format: 'test', token: root },
    provenance: { kind: 'adoption', id: 'operator' },
    git: null,
    state: 'active',
  };
  const roots = Context.get(
    yield* Layer.build(
      Layer.mock(FileRoots, {
        namespaceId: registered.namespaceId,
        read: () => Effect.succeed(registered),
        active: () => Effect.succeed([registered]),
        scope: () => ({ resolve: () => Effect.die('the checkout-files fixture does not resolve root footprints') }),
      }),
    ),
    FileRoots,
  );
  const place: ProjectRoot = { projectId: 1, rootId: registered.rootId, path: root, origin: 'canonical' };
  const scope = yield* Effect.scope;
  const watch = yield* checkoutWatches(git, roots, scope);
  const worker = yield* Effect.acquireRelease(Effect.sync(makeFilesWorker), (worker) => Effect.sync(() => worker.close()));
  const statted: string[] = [];
  const checkoutPaths = yield* fixedCheckoutPaths(1, [{ checkout: registered.rootId, root }]);
  return {
    files,
    paths,
    root,
    place,
    git,
    roots,
    checkoutPaths,
    spawned,
    run,

    write: Effect.fnUntraced(function* (path: string, text: string) {
      yield* files.makeDirectory(paths.dirname(paths.join(root, path)), { recursive: true });
      yield* files.writeFileString(paths.join(root, path), text);
    }),

    watch,
    statted,
    directories: yield* makeDirectoryListing({ worker, graphDirectory: GRAPH }).pipe(
      Effect.provideService(Git, git),
      Effect.provideService(CheckoutPaths, checkoutPaths),
      Effect.provideService(CheckoutWatch, watch),
    ),
    documents: yield* makeOpenDocuments({
      targets: yield* makeTargets({ graph: GRAPH }).pipe(Effect.provideService(CheckoutPaths, checkoutPaths)),
      worker,
      folders: makeFolderWatches(),
      stat: (path) => Effect.suspend(() => (statted.push(path), workingAt(path, Date.now()))),
    }).pipe(
      Effect.provideService(CheckoutWatch, watch),
      Effect.provideService(Renames, unrenamed),
      Effect.provideService(Scope.Scope, scope),
    ),
    searches: yield* makeContentSearches({ graphDirectory: GRAPH }).pipe(
      Effect.provideService(RipgrepBinary, { path: () => Effect.promise(() => resolveRipgrepPath()) }),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, yield* ChildProcessSpawner.ChildProcessSpawner),
    ),
    indexes: yield* makePathIndexes({ worker, graphDirectory: GRAPH }).pipe(
      Effect.provideService(Git, git),
      Effect.provideService(CheckoutWatch, watch),
    ),
  };
});

export const feeding = Effect.fnUntraced(function* <A, E>(stream: Stream.Stream<A, E>) {
  const queue = yield* Queue.unbounded<{ readonly ok: A } | { readonly err: E }>();
  yield* Effect.forkScoped(
    Stream.runForEach(
      stream.pipe(
        Stream.map((ok) => ({ ok }) as const),
        Stream.catch((err) => Stream.make({ err } as const)),
      ),
      (item) => Queue.offer(queue, item),
    ),
  );
  const next: Effect.Effect<A, E> = Queue.take(queue).pipe(
    Effect.timeoutOrElse({ duration: '10 seconds', orElse: () => Effect.die('no frame within 10 seconds') }),
    Effect.flatMap((item) => ('ok' in item ? Effect.succeed(item.ok) : Effect.fail(item.err))),
  );
  const until = (found: (item: A) => boolean): Effect.Effect<A, E> =>
    Effect.flatMap(next, (item) => (found(item) ? Effect.succeed(item) : until(found)));
  return { next, until };
});
