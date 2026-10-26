import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, Layer, Scope, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { Git } from '@runlith/git/Git';
import { Intake } from '../change-record/contract/service/intake.js';
import { Capacity } from '../platform/contract/service/capacity.js';
import { Maintenance, scheduleSweeps } from '../platform/contract/service/maintenance.js';
import { actingGit, configuredGit } from '../platform/git/ownGit.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch } from '../workspace/contract/service/watch.js';
import { Directories } from './contract/service/directories.js';
import { Documents } from './contract/service/documents.js';
import { Entries } from './contract/service/entries.js';
import { PathIndex } from './contract/service/pathIndex.js';
import { Reveal } from './contract/service/reveal.js';
import { Renames } from './contract/service/renames.js';
import { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { Searches } from './contract/service/searches.js';
import { launching, makeRevealInFiles } from './reveal/files.js';
import { makeFolderWatches } from './documents/folders.js';
import { makeOpenDocuments } from './documents/open.js';
import { makeEntryRecord } from './entries/record.js';
import { makeTreeEntries } from './entries/tree.js';
import { makePathIndexes } from './finding/indexes.js';
import { makeDirectoryListing } from './listing/directory.js';
import { makeContentSearches } from './search/content.js';
import { makeCheckoutTrash } from './trash/bin.js';
import { makeGitDirs, makeTrashActs } from './trash/place.js';
import { makeTargets } from './tree/target.js';
import { trashSweep } from './trash/sweep.js';
import { makeFilesWorker } from './worker/client.js';
import { makeDocumentSaves } from './writing/document.js';

const spawner = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

export const checkoutFilesServingLayer: Layer.Layer<
  Directories | PathIndex | Searches | Documents | Entries | Reveal,
  never,
  Git | CheckoutPaths | CheckoutWatch | GraphDirectory | RipgrepBinary | Intake | Renames | FileRoots | Maintenance | Capacity
> = Layer.effectContext(
  Effect.gen(function* () {
    const source = yield* Git;
    const git = actingGit(source, 'checkout-files');
    const reading = configuredGit(source, 'checkout-files');
    const graph = yield* GraphDirectory;
    const worker = makeFilesWorker();
    const scope = yield* Scope.Scope;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => worker.close()),
    );
    const targets = yield* makeTargets({ graph });
    const open = yield* makeOpenDocuments({ targets, worker, folders: makeFolderWatches() });
    const saves = yield* makeDocumentSaves({ documents: open, targets, worker }).pipe(Effect.provideService(Git, git));
    const record = yield* makeEntryRecord({ worker }).pipe(Effect.provideService(Git, git));
    const gitDirs = yield* makeGitDirs().pipe(Effect.provideService(Git, git));
    const acts = makeTrashActs();
    yield* scheduleSweeps('trash-sweep', [trashSweep(yield* FileRoots, gitDirs, acts, yield* Capacity)]);
    return Context.make(
      Directories,
      yield* makeDirectoryListing({ worker, graphDirectory: graph }).pipe(Effect.provideService(Git, reading)),
    ).pipe(
      Context.add(PathIndex, yield* makePathIndexes({ worker, graphDirectory: graph }).pipe(Effect.provideService(Git, reading))),
      Context.add(Searches, yield* makeContentSearches({ graphDirectory: graph })),
      Context.add(Documents, {
        subscribe: open.subscribe,
        save: saves.save,
        placeOf: targets.placed,
        subscribeLoose: (projectId, path) => Stream.unwrap(Effect.map(targets.loose(projectId, path), (file) => open.subscribeLoose(file))),
        saveLoose: (projectId, save) => Effect.flatMap(targets.loose(projectId, save.path), (file) => saves.saveLoose(file, save)),
      }),
      Context.add(Entries, makeTreeEntries({ record, bin: makeCheckoutTrash({ record, targets, gitDirs, acts }), targets })),
      Context.add(Reveal, makeRevealInFiles({ targets, launch: launching(yield* ChildProcessSpawner.ChildProcessSpawner) })),
    );
  }),
).pipe(Layer.provide(Layer.mergeAll(spawner, BunFileSystem.layer)));
