import { Schema } from 'effect';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal, type Actor } from '../../../../platform/contract/wire/actor.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { FOLDER_NAME_CHARS, threadFolderSchema } from '../../../../thread-record/contract/wire/folder.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { placeRole, projectField } from '../../../../platform/contract/wire/place.js';
import { Duration } from 'effect';

const subject = (address: string, actor: Actor) =>
  actor.kind !== 'operator' ? [{ kind: 'write' as const, value: threadAgentSubject(signerPrincipal(actor), address) }] : [];

const FOLDER_TOOL = {
  doors: { http: true },
  tool: { capability: 'threads' },
  callers: 'any',
  subject: 'none',
  place: 'project',
  graph: 'none',
  waits: [],
  lifetimes: [],
} as const;

const FOLDER_WRITE = { ...FOLDER_TOOL, effect: 'write', identity: { key: 'call' } } as const;

const FOLDER_GRAMMAR =
  "A folder is the reader's own shelf in the project's thread list: it holds whole spawn trees, filed by their root, and subfolders to any depth; `parentId` names the folder a folder stands in, `null` is the top level. It is the reader's arrangement of a surface you cannot see, so under `trust` it is asked before it happens.";

const folderId = Schema.NonEmptyString.annotate({ description: 'A folder of this project, as list_thread_folders answers it.' });
const folderName = Schema.NonEmptyString.check(Schema.isMaxLength(FOLDER_NAME_CHARS)).annotate({
  description: `The folder's name, up to ${FOLDER_NAME_CHARS} characters; whitespace collapses.`,
});
const filedIds = Schema.Array(ThreadId).annotate({
  description: 'Threads to file. An id inside a spawn tree files the tree it belongs to.',
});
const parentId = Schema.NullOr(folderId).annotate({
  ...placeRole('value'),
  description: 'The folder to stand in, as list_thread_folders answers it; null is the top level.',
});
const folders = Schema.Array(threadFolderSchema);

export const FOLDER_OPERATIONS = {
  list_thread_folders: operation('list_thread_folders', {
    approval: ASKS_NEVER,
    ...FOLDER_TOOL,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { folders } }),
    meaning:
      "Every folder of this project's thread list as one flat list, ordered by `position` among the siblings that share a `parentId`. A thread row's `folderId` names the folder its tree is filed in.",
    grammar: FOLDER_GRAMMAR,
    input: Schema.Struct({ project: projectField }),
    refusals: [],
    subjects: (_input, _prepared, actor) =>
      actor.kind !== 'operator' ? [{ kind: 'read' as const, value: threadAgentSubject(signerPrincipal(actor), '*') }] : [],
    confirmation: () => ({ summary: 'Read the thread folders?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the thread folders', done: 'Read the thread folders' },
  }),

  create_thread_folder: operation('create_thread_folder', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...FOLDER_WRITE,
    answer: arms({ created: { folder: threadFolderSchema, moved: Schema.Array(Schema.String) } }),
    meaning:
      'Make a new folder at the end of the folders inside `parentId` (the top level when it is null or left out), and file the named trees into it in the same act.',
    grammar: `${FOLDER_GRAMMAR} Filing a tree releases its pin. A thread of another project refuses \`not-found\` and nothing is made.`,
    input: Schema.Struct({
      project: projectField,
      name: folderName,
      parentId: Schema.optional(parentId),
      threadIds: Schema.optional(filedIds),
    }),
    refusals: ['not-found', 'folder-not-found', 'name-empty'],
    subjects: (input, _prepared, actor) => [...subject('*', actor), ...(input.threadIds ?? []).flatMap((id) => subject(id, actor))],
    confirmation: (input) => ({ summary: `Make the folder "${input.name}"?` }),
    confirmLabel: 'Make',
    presentation: { running: 'Making a thread folder', done: 'Made a thread folder' },
  }),

  rename_thread_folder: operation('rename_thread_folder', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...FOLDER_WRITE,
    answer: arms({ renamed: { folder: threadFolderSchema } }),
    meaning: 'Give a folder of the thread list another name.',
    grammar: FOLDER_GRAMMAR,
    input: Schema.Struct({ project: projectField, folderId, name: folderName }),
    refusals: ['folder-not-found', 'name-empty'],
    subjects: (_input, _prepared, actor) => subject('*', actor),
    confirmation: (input) => ({ summary: `Rename the folder to "${input.name}"?` }),
    confirmLabel: 'Rename',
    presentation: { running: 'Renaming a thread folder', done: 'Renamed a thread folder' },
  }),

  move_thread_folder: operation('move_thread_folder', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...FOLDER_WRITE,
    answer: arms({ moved: { folders } }),
    meaning: 'Move a folder to another place among its siblings, or into another folder or the top level.',
    grammar: `${FOLDER_GRAMMAR} \`parentId\` left out keeps the folder where it stands, \`null\` moves it to the top level, a folder id moves it inside that folder. \`index\` is the folder's place counted from 0 among the siblings once it stands there; past the end means the end. A folder inside itself or inside one of its own subfolders refuses \`folder-cycle\`; an unknown folder or parent refuses \`folder-not-found\`.`,
    input: Schema.Struct({
      project: projectField,
      folderId,
      index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      parentId: Schema.optional(parentId),
    }),
    refusals: ['folder-not-found', 'folder-cycle'],
    subjects: (_input, _prepared, actor) => subject('*', actor),
    confirmation: () => ({ summary: 'Move this thread folder?' }),
    confirmLabel: 'Move',
    presentation: { running: 'Moving a thread folder', done: 'Moved a thread folder' },
  }),

  delete_thread_folder: operation('delete_thread_folder', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...FOLDER_WRITE,
    answer: arms({
      deleted: {
        folderId: Schema.String,
        removed: Schema.Array(Schema.String),
        released: Schema.Array(Schema.Struct({ threadId: Schema.String, folderId: Schema.String })),
      },
    }),
    meaning:
      'Take a folder away together with its whole subtree of subfolders. Every tree filed in any of them goes back to the list unfiled; no thread is touched beyond that.',
    grammar: `${FOLDER_GRAMMAR} \`removed\` names every folder taken away, the asked one first and each parent before its subfolders; \`released\` names each freed tree with the folder it was filed in. Archived trees that were filed there come back unfiled too.`,
    input: Schema.Struct({ project: projectField, folderId }),
    refusals: ['folder-not-found'],
    subjects: (_input, _prepared, actor) => subject('*', actor),
    confirmation: () => ({ summary: 'Take this folder and its subfolders away? Their threads stay in the list.' }),
    confirmLabel: 'Remove',
    presentation: { running: 'Removing a thread folder', done: 'Removed a thread folder' },
  }),

  file_threads: operation('file_threads', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...FOLDER_WRITE,
    answer: arms({
      filed: { folderId: Schema.NullOr(Schema.String), roots: Schema.Array(Schema.String), moved: Schema.Array(Schema.String) },
    }),
    meaning: 'Put spawn trees into a folder, or take them out of whichever folder holds them.',
    grammar: `${FOLDER_GRAMMAR} \`folderId: null\` takes the trees out. Filing releases a tree's pin; a pinned tree keeps its folder and returns to it when unpinned. \`roots\` names the trees the ids resolved to, \`moved\` the ones whose place changed. A thread of another project refuses \`not-found\` and nothing moves.`,
    input: Schema.Struct({ threadIds: filedIds.check(Schema.isMinLength(1)), folderId: Schema.NullOr(folderId) }),
    refusals: ['not-found', 'folder-not-found'],
    subjects: (input, _prepared, actor) => input.threadIds.flatMap((id) => subject(id, actor)),
    confirmation: (input) => ({
      summary:
        input.folderId === null
          ? `Take ${input.threadIds.length} thread(s) out of their folder?`
          : `File ${input.threadIds.length} thread(s) into a folder?`,
    }),
    confirmLabel: 'File',
    presentation: { running: 'Filing threads', done: 'Filed threads', many: (count) => `Filed threads ${count} times` },
  }),
};

export type FolderOperationId = keyof typeof FOLDER_OPERATIONS;
