import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { ThreadFolder } from '../wire/folder.js';

export type Filing =
  | { readonly status: 'filed'; readonly roots: readonly ThreadId[]; readonly moved: readonly ThreadId[] }
  | { readonly status: 'no-folder' }
  | { readonly status: 'missing'; readonly missing: readonly string[] };

export type FolderCreated =
  | { readonly status: 'created'; readonly folder: ThreadFolder; readonly moved: readonly ThreadId[] }
  | { readonly status: 'no-parent' }
  | { readonly status: 'missing'; readonly missing: readonly string[] };

export type FolderMoved =
  | { readonly status: 'moved'; readonly folders: readonly ThreadFolder[] }
  | { readonly status: 'no-folder' }
  | { readonly status: 'no-parent' }
  | { readonly status: 'cycle' };

export type ReleasedTree = { readonly threadId: ThreadId; readonly folderId: string };

export type FolderReleased = {
  readonly folder: ThreadFolder;
  readonly removed: readonly string[];
  readonly released: readonly ReleasedTree[];
};

export type FoldersRegrouped = {
  readonly groupId: number;
  readonly projects: readonly number[];
  readonly refiled: readonly ThreadId[];
};

export class ThreadFolders extends Context.Service<
  ThreadFolders,
  {
    list(projectId: number): Effect.Effect<readonly ThreadFolder[], StoreFailure>;
    regrouped(subscriber: (event: FoldersRegrouped) => Effect.Effect<void>): () => void;
    create(
      projectId: number,
      name: string,
      parentId: string | null,
      threadIds: readonly string[],
    ): Effect.Effect<FolderCreated, StoreFailure>;
    rename(projectId: number, folderId: string, name: string): Effect.Effect<ThreadFolder | undefined, StoreFailure>;
    move(projectId: number, folderId: string, parentId: string | null | undefined, index: number): Effect.Effect<FolderMoved, StoreFailure>;
    remove(projectId: number, folderId: string): Effect.Effect<FolderReleased | undefined, StoreFailure>;
    file(projectId: number, threadIds: readonly string[], folderId: string | null): Effect.Effect<Filing, StoreFailure>;
  }
>()('tagma/thread-record/ThreadFolders') {}
