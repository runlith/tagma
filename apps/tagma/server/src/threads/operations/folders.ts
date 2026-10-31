import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { addressed } from '../addresses.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ThreadFolders } from '../../thread-record/contract/service/folders.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { folderNameOf } from '../../thread-record/contract/wire/folder.js';
import { ThreadList } from '../contract/service/list.js';
import { FOLDER_OPERATIONS as OPS, type FolderOperationId } from '../contract/wire/operations/folders.js';

const unnamed = () =>
  new GateRefusal('name-empty', 'A folder is found by its name, and this one is blank once its whitespace collapses.', [
    'name it with at least one visible character',
  ]);

const noFolder = (folderId: string) =>
  new GateRefusal('folder-not-found', `No folder ${folderId} stands in this project.`, [
    'read list_thread_folders and name one it answers',
  ]);

const noParent = (parentId: string) =>
  new GateRefusal('folder-not-found', `No folder ${parentId} stands in this project to hold the folder.`, [
    'read list_thread_folders and name a parent it answers, or leave `parentId` out for the top level',
  ]);

const cycle = (folderId: string, parentId: string) =>
  new GateRefusal(
    'folder-cycle',
    `Folder ${folderId} cannot stand inside ${parentId}: that is the folder itself or one of its own subfolders.`,
    ['pick a parent outside the moving folder and its subfolders', 'pass `parentId: null` to move it to the top level'],
  );

const missingThreads = (missing: readonly string[]) =>
  new GateRefusal('not-found', `No thread ${missing.join(', ')} stands in this project.`, ["read the project's thread list"]);

const filingIds = (addresses: readonly string[], caller: Caller) =>
  Effect.forEach(addresses, (address) => Effect.map(addressed(address, caller), (found) => found?.threadId ?? address));

const announced = Effect.fnUntraced(function* (projectId: number, moved: readonly string[]) {
  const list = yield* ThreadList;
  for (const id of moved) yield* list.announceThread(id);
  list.announceFolders(projectId, yield* (yield* ThreadFolders).list(projectId));
});

export const FOLDER_PAIRS: { readonly [K in FolderOperationId]: OperationPair<(typeof OPS)[K]> } = {
  list_thread_folders: pair(
    OPS.list_thread_folders,
    body(OPS.list_thread_folders, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* CurrentProject;
        return { status: 'ok' as const, folders: yield* (yield* ThreadFolders).list(call.project.id) };
      }),
    }),
  ),

  create_thread_folder: pair(
    OPS.create_thread_folder,
    body<typeof OPS.create_thread_folder, readonly string[], ThreadRecords | CurrentProject | ThreadFolders | ThreadList>(
      OPS.create_thread_folder,
      {
        prepare: (input, caller) => filingIds(input.threadIds ?? [], caller),
        execute: Effect.fnUntraced(function* (input, threadIds) {
          const call = yield* yield* CurrentProject;
          const name = folderNameOf(input.name);
          if (name === null) return yield* unnamed();
          const made = yield* (yield* ThreadFolders).create(call.project.id, name, input.parentId ?? null, threadIds);
          if (made.status === 'no-parent') return yield* noParent(input.parentId ?? '');
          if (made.status === 'missing') return yield* missingThreads(made.missing);
          yield* announced(call.project.id, made.moved);
          return { status: 'created' as const, folder: made.folder, moved: made.moved };
        }),
      },
    ),
  ),

  rename_thread_folder: pair(
    OPS.rename_thread_folder,
    body(OPS.rename_thread_folder, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const name = folderNameOf(input.name);
        if (name === null) return yield* unnamed();
        const folder = yield* (yield* ThreadFolders).rename(call.project.id, input.folderId, name);
        if (folder === undefined) return yield* noFolder(input.folderId);
        yield* announced(call.project.id, []);
        return { status: 'renamed' as const, folder };
      }),
    }),
  ),

  move_thread_folder: pair(
    OPS.move_thread_folder,
    body(OPS.move_thread_folder, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const moved = yield* (yield* ThreadFolders).move(call.project.id, input.folderId, input.parentId, input.index);
        if (moved.status === 'no-folder') return yield* noFolder(input.folderId);
        if (moved.status === 'no-parent') return yield* noParent(input.parentId ?? '');
        if (moved.status === 'cycle') return yield* cycle(input.folderId, input.parentId ?? '');
        (yield* ThreadList).announceFolders(call.project.id, moved.folders);
        return { status: 'moved' as const, folders: moved.folders };
      }),
    }),
  ),

  delete_thread_folder: pair(
    OPS.delete_thread_folder,
    body(OPS.delete_thread_folder, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const removed = yield* (yield* ThreadFolders).remove(call.project.id, input.folderId);
        if (removed === undefined) return yield* noFolder(input.folderId);
        yield* announced(
          call.project.id,
          removed.released.map((tree) => tree.threadId),
        );
        return { status: 'deleted' as const, folderId: removed.folder.id, removed: removed.removed, released: removed.released };
      }),
    }),
  ),

  file_threads: pair(
    OPS.file_threads,
    body<typeof OPS.file_threads, readonly string[], ThreadRecords | CurrentProject | ThreadFolders | ThreadList>(OPS.file_threads, {
      prepare: (input, caller) => filingIds(input.threadIds, caller),
      execute: Effect.fnUntraced(function* (input, threadIds) {
        const call = yield* yield* CurrentProject;
        const filed = yield* (yield* ThreadFolders).file(call.project.id, threadIds, input.folderId);
        if (filed.status === 'no-folder') return yield* noFolder(input.folderId ?? '');
        if (filed.status === 'missing') return yield* missingThreads(filed.missing);
        const list = yield* ThreadList;
        for (const id of filed.moved) yield* list.announceThread(id);
        return { status: 'filed' as const, folderId: input.folderId, roots: filed.roots, moved: filed.moved };
      }),
    }),
  ),
};
