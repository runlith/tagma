import { Effect, FileSystem, Scope } from 'effect';
import { Git } from '@runlith/git/Git';
import { Intake } from '../../../change-record/contract/service/intake.js';
import { Renames } from '../../../checkout-files/contract/service/renames.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { CheckoutWatch } from '../../../workspace/contract/service/watch.js';
import { changeRecordOf } from '../../../change-record/testing/doubles.js';
import { makeFolderWatches } from '../../../checkout-files/documents/folders.js';
import { makeOpenDocuments } from '../../../checkout-files/documents/open.js';
import { makeEntryRecord } from '../../../checkout-files/entries/record.js';
import { makeTreeEntries } from '../../../checkout-files/entries/tree.js';
import { makeCheckoutTrash } from '../../../checkout-files/trash/bin.js';
import { makeGitDirs, makeTrashActs } from '../../../checkout-files/trash/place.js';
import { makeTargets } from '../../../checkout-files/tree/target.js';
import { makeFilesWorker } from '../../../checkout-files/worker/client.js';
import { makeDocumentSaves } from '../../../checkout-files/writing/document.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import { checkoutWatches, fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { PROJECT, fixture } from '../change-record/threadFilesWorld.js';
export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
export const filesWorld = Effect.gen(function* () {
  const base = yield* fixture;
  const checkoutPaths = yield* fixedCheckoutPaths(PROJECT, [{ checkout: base.rootId, root: base.root }]);
  const record = yield* changeRecordOf(base.store, base.units, checkoutPaths, base.intake);
  const worker = makeFilesWorker();
  yield* Effect.addFinalizer(() => Effect.sync(() => worker.close()));
  const scope = yield* Effect.scope;
  const targets = yield* makeTargets({ graph: '.tagma' }).pipe(Effect.provideService(CheckoutPaths, checkoutPaths));
  const documents = yield* makeOpenDocuments({ targets, worker, folders: makeFolderWatches() }).pipe(
    Effect.provideService(CheckoutWatch, yield* checkoutWatches(base.git, base.roots, scope)),
    Effect.provideService(Renames, record),
    Effect.provideService(Scope.Scope, scope),
  );
  const entryRecord = yield* makeEntryRecord({ worker }).pipe(
    Effect.provideService(Intake, base.intake),
    Effect.provideService(CheckoutPaths, checkoutPaths),
    Effect.provideService(Git, base.git),
  );
  const place: ProjectRoot = { projectId: PROJECT, rootId: base.rootId, path: base.root, origin: 'canonical' };
  const at = (path: string) => base.paths.join(base.root, path);
  const write = Effect.fnUntraced(function* (path: string, text: string) {
    yield* base.files.makeDirectory(base.paths.dirname(at(path)), { recursive: true });
    yield* base.files.writeFileString(at(path), text);
  });
  return {
    ...base,
    place,
    at,
    write,
    documents,
    targets,
    saves: yield* makeDocumentSaves({ documents, targets, worker }).pipe(
      Effect.provideService(Intake, base.intake),
      Effect.provideService(Git, base.git),
      Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem),
    ),
    entries: makeTreeEntries({
      record: entryRecord,
      bin: makeCheckoutTrash({
        record: entryRecord,
        targets,
        gitDirs: yield* makeGitDirs().pipe(Effect.provideService(Git, base.git)),
        acts: makeTrashActs(),
      }),
      targets,
    }),
  };
});
