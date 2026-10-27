import { resolve, sep } from 'node:path';
import { Effect, Stream } from 'effect';
import { refusing } from '../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../platform/contract/wire/refusal.js';
import type { RootResolutionFailure } from '../workspace/contract/wire/roots.js';
import type { CheckoutPlaces } from '../workspace/contract/service/checkouts.js';
import { rootReadRefusal } from '../workspace/roots/refusal.js';
import type { Directories } from './contract/service/directories.js';
import type { Documents } from './contract/service/documents.js';
import type { LooseFolders } from './contract/service/folders.js';
import type { ScratchFolders } from './contract/service/scratch.js';
import type { Searches } from './contract/service/searches.js';
import type { TreeFrame } from './contract/wire/directory.js';
import type { DocumentFrame } from './contract/wire/document.js';
import type { FolderFrame } from './contract/wire/scratch.js';
import type { SearchFrame } from './contract/wire/search.js';

type Place = { readonly projectId: number; readonly root?: string };

const refusalOf = (failure: GateRefusal | RootResolutionFailure): GateRefusal =>
  failure instanceof GateRefusal ? failure : rootReadRefusal(failure);

export const filesChannel = (
  places: CheckoutPlaces['Service'],
  directories: Directories['Service'],
  searches: Searches['Service'],
  documents: Documents['Service'],
  folders: LooseFolders['Service'],
  scratches: ScratchFolders['Service'],
) => ({
  'tree.subscribe': ({ projectId, root }: Place): Stream.Stream<TreeFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const rootId = yield* refusing(places.rootOf({ projectId, cwd: undefined }, root));
        return Stream.mapError(directories.tree(rootId), refusalOf);
      }),
    ),
  'search.subscribe': ({
    projectId,
    root,
    pattern,
    regex,
    caseSensitive,
    wholeWord,
    include,
    exclude,
  }: Place & {
    readonly pattern: string;
    readonly regex: boolean;
    readonly caseSensitive: boolean;
    readonly wholeWord: boolean;
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  }): Stream.Stream<SearchFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const place = yield* refusing(places.placeOf({ projectId, cwd: undefined }, root));
        return Stream.mapError(
          searches.run(place, { pattern, regex, caseSensitive, wholeWord, include: include ?? [], exclude: exclude ?? [] }),
          refusalOf,
        );
      }),
    ),
  'document.subscribe': ({ projectId, root, path }: Place & { readonly path: string }): Stream.Stream<DocumentFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const place = yield* refusing(places.placeOf({ projectId, cwd: undefined }, root));
        return Stream.mapError(documents.subscribe(place, path), refusalOf);
      }),
    ),
  'file.subscribe': ({
    projectId,
    path,
  }: {
    readonly projectId: number;
    readonly path: string;
  }): Stream.Stream<DocumentFrame, RefusalBody> => Stream.mapError(documents.subscribeLoose(projectId, path), refusalOf),
  'scratch.subscribe': ({
    thread,
    path,
    limit,
  }: {
    readonly thread: string;
    readonly path?: string | undefined;
    readonly limit: number;
  }): Stream.Stream<FolderFrame, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const scratch = yield* scratches.of(thread);
        const directory = resolve(scratch, path ?? '');
        if (directory !== scratch && !directory.startsWith(`${scratch}${sep}`)) {
          return yield* new GateRefusal('path-outside-tree', `${path} leaves the scratch of thread ${thread}`, [
            "name a folder inside the thread's scratch",
          ]);
        }
        return folders.subscribe(directory, limit);
      }),
    ),
});
