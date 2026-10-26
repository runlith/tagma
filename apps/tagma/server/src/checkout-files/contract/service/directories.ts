import { Context, type Effect, type Stream } from 'effect';
import type { Page } from '@runlith/paging';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';
import type { DirectoryEntry, TreeFrame } from '../wire/directory.js';

export type DirectoryRefusal =
  | 'path-outside-tree'
  | 'graph-path'
  | 'not-found'
  | 'not-a-directory'
  | 'files'
  | 'worker-unavailable'
  | 'bad-cursor'
  | 'cursor-stale'
  | GitRefusal;

export type DirectoryAsk = {
  readonly path: string;
  readonly ignored: boolean;
  readonly rows: number;
  readonly cursor: string | undefined;
};

export class Directories extends Context.Service<
  Directories,
  {
    list(
      place: ProjectRoot,
      ask: DirectoryAsk,
    ): Effect.Effect<Page<DirectoryEntry> & { readonly total: number }, GateRefusal<DirectoryRefusal>>;
    tree(rootId: RootId): Stream.Stream<TreeFrame, RootResolutionFailure>;
  }
>()('tagma/checkout-files/Directories') {}
