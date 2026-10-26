import { Schema } from 'effect';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { LineEditFrame, LOOSE_REFUSALS } from './document.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

const root = Schema.optional(
  Schema.NonEmptyString.annotate({
    ...placeRole('value'),
    description: "A registered root id or an absolute path, in any registered project's checkout; omitted: the project checkout.",
  }),
);

const entryPath = Schema.NonEmptyString.annotate({ ...placeRole('value'), description: 'Relative to the checkout root.' });

const UNCONFIRMED = Schema.NullOr(Schema.String).annotate({
  description: 'Set when the files are written but their record rows stand as intents the next start confirms; the reason it failed.',
});

const TREE = ['path-outside-tree', 'graph-path', 'files', 'record-unread', 'file-write-failed'] as const;

export const WRITE_REFUSALS = [
  ...PLACE_REFUSALS,
  ...GIT_REFUSALS,
  ...TREE,
  'not-text',
  'too-large',
  'not-a-file',
  'edits-invalid',
  'worker-unavailable',
] as const;

export const ENTRY_REFUSALS = [
  ...PLACE_REFUSALS,
  ...GIT_REFUSALS,
  ...TREE,
  'target-exists',
  'source-moved',
  'same-path',
  'cross-device',
  'not-a-directory',
  'worker-unavailable',
] as const;

export const EntryKind = Schema.Literals(['file', 'directory']);
export type EntryKind = typeof EntryKind.Type;

export const EntryMove = Schema.Struct({ from: entryPath, to: entryPath });
export type EntryMove = typeof EntryMove.Type;

const RECORDED = `Every file git could commit is recorded as the operator's: the change record of the checkout's own project holds its lines under the operator, as it holds a thread's.`;

const WRITE = {
  approval: ASKS_IN_REVIEW,
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  effect: 'write',
  identity: { key: 'call' },
} as const;

export const WRITE_OPERATIONS = {
  write_document: operation('write_document', {
    ...WRITE,
    answer: arms({
      ok: { digest: Schema.NonEmptyString, kept: Schema.Boolean, unconfirmed: UNCONFIRMED },
      moved: { digest: Schema.NullOr(Schema.NonEmptyString) },
    }),
    negative: ['moved'],
    meaning:
      "Save the operator's edit of one file of a checkout: line edits over the bytes the editor last saw, recorded as the operator's lines.",
    grammar: `\`base\` is the digest of the bytes the edit was made over, as the document feed sent it; null creates the file and refuses \`moved\` when it exists. The answer \`moved\` carries the digest standing now (null: no file) and writes nothing: wait for the document frame of that digest, rebase, and save again.
\`edits\` are line edits of the document's LF text, as the document feed's \`change\` frames carry them: line \`k\` of a text with \`k\` line breaks is the text after the last one. Untouched lines keep their bytes — CRLF, a byte order mark, a missing final newline — and new lines take the line ending most of the file uses. \`text\` replaces the whole text instead; exactly one of the two is given.
\`write\` is the caller's own id for this save: the document feed's \`change\` frame this save causes carries it, so the editor knows its own echo.
A file that is not UTF-8 text refuses \`not-text\`, one larger than the change record keeps texts of \`too-large\`. A path through a link is saved at the link's target, and a target outside the checkout refuses \`path-outside-tree\`, as do absolute paths and git's own directory. ${RECORDED} \`record-unread\` means the record could not take the write and the file was not touched; \`unconfirmed\` that the file is written and its row waits for the next start.`,
    input: Schema.Struct({
      root,
      path: entryPath,
      base: Schema.NullOr(Schema.NonEmptyString),
      write: Schema.NonEmptyString,
      edits: Schema.optional(Schema.Array(LineEditFrame)),
      text: Schema.optional(Schema.String),
    }),
    refusals: WRITE_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Save ${input.path}?` }),
    confirmLabel: 'Save',
    presentation: { running: 'Saving a file', done: 'Saved a file', many: (count) => `Saved ${count} files` },
  }),

  write_file: operation('write_file', {
    ...WRITE,
    answer: arms({
      ok: { digest: Schema.NonEmptyString },
      moved: { digest: Schema.NullOr(Schema.NonEmptyString) },
    }),
    negative: ['moved'],
    meaning:
      "Save the operator's edit of a file on the server's disk outside every project's checkouts: what the editor does for a file opened by its absolute path.",
    grammar: `Takes \`base\`, \`write\`, \`edits\` and \`text\` exactly as write_document does, over the bytes the \`file.subscribe\` feed sent, and answers the same \`moved\`. \`path\` is absolute; a relative one refuses \`path-relative\`, and a file inside a checkout of any registered project refuses \`in-checkout\` — those are saved with write_document so the change record holds their lines. No git and no change record stand behind this file: the save is the bytes on disk and nothing else.`,
    input: Schema.Struct({
      path: Schema.NonEmptyString.annotate({ ...placeRole('value'), description: 'Absolute path of the file.' }),
      base: Schema.NullOr(Schema.NonEmptyString),
      write: Schema.NonEmptyString,
      edits: Schema.optional(Schema.Array(LineEditFrame)),
      text: Schema.optional(Schema.String),
    }),
    refusals: [
      ...PLACE_REFUSALS,
      ...LOOSE_REFUSALS,
      'file-write-failed',
      'not-text',
      'too-large',
      'not-a-file',
      'edits-invalid',
      'worker-unavailable',
    ],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Save ${input.path}?` }),
    confirmLabel: 'Save',
    presentation: { running: 'Saving a file', done: 'Saved a file', many: (count) => `Saved ${count} files` },
  }),

  create_entry: operation('create_entry', {
    ...WRITE,
    answer: arms({ ok: { path: Schema.NonEmptyString, unconfirmed: UNCONFIRMED } }),
    meaning: 'Create an empty file or a directory in a checkout, with every missing directory on its way.',
    grammar: `\`path\` may name directories that do not exist yet: they are created. An entry standing at \`path\` refuses \`target-exists\`, a file on the way \`not-a-directory\`. A new file is recorded as the operator's empty file; a directory is no file and records nothing.`,
    input: Schema.Struct({ root, path: entryPath, kind: EntryKind }),
    refusals: ENTRY_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Create ${input.path}?` }),
    confirmLabel: 'Create',
    presentation: { running: 'Creating an entry', done: 'Created an entry', many: (count) => `Created ${count} entries` },
  }),

  move_entries: operation('move_entries', {
    ...WRITE,
    answer: arms({ ok: { moved: Schema.Array(EntryMove), unconfirmed: UNCONFIRMED } }),
    meaning: 'Rename or move files and directories of a checkout in one act: what rename and drag-and-drop in the file tree do.',
    grammar: `Each pair names an entry and the path it takes, missing directories on the way created. A directory moves whole, and moving one to another volume refuses \`cross-device\`. Every pair is checked before any moves: an entry standing at a \`to\` refuses \`target-exists\`, as does a \`to\` inside another pair's \`from\` or \`to\`; a \`from\` that is gone refuses \`source-moved\`, a \`to\` equal to its \`from\` \`same-path\`. A failure halfway puts back what already moved. ${RECORDED} Each moved file is recorded as the operator's deletion of its old path and creation of its new one, the new one naming the old; a file git ignores records nothing.`,
    input: Schema.Struct({ root, pairs: Schema.Array(EntryMove).check(Schema.isMinLength(1)) }),
    refusals: ENTRY_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Move ${input.pairs.length} entries?` }),
    confirmLabel: 'Move',
    presentation: { running: 'Moving entries', done: 'Moved entries', many: (count) => `Moved entries ${count} times` },
  }),

  trash_entries: operation('trash_entries', {
    ...WRITE,
    answer: arms({ ok: { trash: Schema.NonEmptyString, unconfirmed: UNCONFIRMED } }),
    meaning: "Delete files and directories of a checkout into Tagma's trash, from which restore_entries brings them back.",
    grammar: `The entries are moved into the trash inside the checkout's git directory, under one id the answer names; restore_entries with that id undoes the act. ${RECORDED} Each deleted file is recorded as the operator's deletion; a file git ignores records nothing. The trash keeps an act for a week and within a share of the disk's free space, and is emptied oldest first beyond either.`,
    input: Schema.Struct({ root, paths: Schema.Array(entryPath).check(Schema.isMinLength(1)) }),
    refusals: ENTRY_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Delete ${input.paths.length} entries?` }),
    confirmLabel: 'Delete',
    presentation: { running: 'Deleting entries', done: 'Deleted entries', many: (count) => `Deleted entries ${count} times` },
  }),

  restore_entries: operation('restore_entries', {
    ...WRITE,
    answer: arms({ ok: { paths: Schema.Array(Schema.NonEmptyString), unconfirmed: UNCONFIRMED } }),
    meaning: 'Bring back what one trash_entries act deleted, to the paths it was deleted from.',
    grammar: `\`trash\` is the id trash_entries answered. Any of its paths taken meanwhile refuses \`target-exists\` and nothing moves; a trash already emptied refuses \`source-moved\`. ${RECORDED} Each restored file is recorded as the operator's creation.`,
    input: Schema.Struct({ root, trash: Schema.NonEmptyString }),
    refusals: ENTRY_REFUSALS,
    subjects: () => [],
    confirmation: () => ({ summary: 'Restore deleted entries?' }),
    confirmLabel: 'Restore',
    presentation: { running: 'Restoring entries', done: 'Restored entries', many: (count) => `Restored entries ${count} times` },
  }),
};
