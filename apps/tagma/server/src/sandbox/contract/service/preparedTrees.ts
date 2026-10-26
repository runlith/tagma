import { Context, Data, type Effect, type Scope } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { TreeArchive } from './backends.js';
import type { PreparedTreeManifest, PreparedTreeReconciliation, PreparedTreeRecipe, PreparedTreeRecord } from '../wire/preparedTree.js';

export class PreparedTreeUnavailable extends Data.TaggedError('PreparedTreeUnavailable')<{
  readonly preparedTree: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `prepared-tree-unavailable: ${this.preparedTree} — ${this.reason}`;
  }
}

export class PreparedTreeHeldConflict extends Data.TaggedError('PreparedTreeHeldConflict')<{
  readonly preparedTree: string;
  readonly copies: number;
}> {
  override get message(): string {
    return `prepared-tree-busy: ${this.preparedTree} is being copied by ${this.copies} sandbox${this.copies === 1 ? '' : 'es'}; its removal resumes when they are done.`;
  }
}

export type PreparedTreeSeed = {
  readonly record: PreparedTreeRecord;
  readonly manifest: PreparedTreeManifest;
  readonly archive: TreeArchive;
};

export class PreparedTrees extends Context.Service<
  PreparedTrees,
  {
    readonly build: (
      request: PreparedTreeRecipe & { readonly ownerId: string },
    ) => Effect.Effect<PreparedTreeRecord, PreparedTreeUnavailable | ThreadStorageFailed>;
    readonly byId: (id: string) => Effect.Effect<PreparedTreeRecord | null, ThreadStorageFailed>;
    readonly records: () => Effect.Effect<readonly PreparedTreeRecord[], ThreadStorageFailed>;
    readonly acquire: (
      id: string,
      owner: { readonly ownerId: string; readonly projectId: number },
    ) => Effect.Effect<PreparedTreeSeed, PreparedTreeUnavailable | ThreadStorageFailed, Scope.Scope>;
    readonly release: (
      id: string,
    ) => Effect.Effect<PreparedTreeRecord, PreparedTreeUnavailable | PreparedTreeHeldConflict | ThreadStorageFailed>;
    readonly condemnUnfinished: () => Effect.Effect<readonly string[], ThreadStorageFailed>;
    readonly reconcile: () => Effect.Effect<PreparedTreeReconciliation, ThreadStorageFailed>;
  }
>()('tagma/sandbox/PreparedTrees') {}
