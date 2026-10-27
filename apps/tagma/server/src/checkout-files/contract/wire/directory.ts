import { Schema } from 'effect';
import { PAGE_CURSOR, family } from '@runlith/paging';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, feed, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const DIRECTORY = family('directory', 1, 'json', { text: 64, json: 128 }, 500, () => ({
  name: 'x'.repeat(32),
  kind: 'file',
  ignored: false,
  mediaType: 'text/javascript;charset=utf-8',
}));

export const DIRECTORY_REFUSALS = [
  ...PLACE_REFUSALS,
  ...GIT_REFUSALS,
  'path-outside-tree',
  'graph-path',
  'not-a-directory',
  'files',
  'worker-unavailable',
  'bad-cursor',
  'cursor-stale',
] as const;

export const LinkTarget = Schema.Literals(['directory', 'file', 'broken', 'outside', 'unreadable']);
export type LinkTarget = typeof LinkTarget.Type;

export const DirectoryEntry = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.Literals(['file', 'directory', 'link']),
  ignored: Schema.Boolean,
  target: Schema.optional(LinkTarget),
  mediaType: Schema.optional(Schema.String),
});
export type DirectoryEntry = typeof DirectoryEntry.Type;

export const TreeRescanReason = Schema.Literals(['opened', 'unnamed', 'error', 'lost', 'polling', 'overflow', 'reopened']);
export type TreeRescanReason = typeof TreeRescanReason.Type;

export const TreeFrame = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('dirs'), dirs: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('rescan'), reason: TreeRescanReason }),
]);
export type TreeFrame = typeof TreeFrame.Type;

export const DIRECTORY_OPERATIONS = {
  read_directory: operation('read_directory', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    page: DIRECTORY,
    answer: arms({
      ok: {
        entries: Schema.Array(DirectoryEntry),
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
      },
    }),
    meaning:
      'Read one directory of a checkout for the file tree: its entries in the order the tree shows them, each with its kind and whether git ignores it.',
    grammar: `\`path\` is spelled relative to the checkout root; omitted or empty it is the root itself. Directories come first, then the other names, each group by name ignoring case with digit runs compared by value. The order is the server's because the server cuts the pages. \`.git\`, \`.DS_Store\` and the graph's own directory are never listed.
A \`link\` names a symbolic link; its \`target\` says what it points at: \`directory\` and \`file\` inside the checkout, \`outside\` for a target beyond the checkout (shown, never opened), \`broken\` for a target that is gone. Only a \`directory\` target can be listed.
A \`file\` entry, and a \`link\` whose target is a file, carries the \`mediaType\` its name implies.
\`ignored\` is git's verdict on the entry. Pass \`ignored: true\` when the directory itself is already known to be ignored: every entry in it is ignored and git is not asked.
\`limit\` and \`cursor\` page the listing; \`total\` counts every entry of the directory, and \`next\` continues a cut.`,
    input: Schema.Struct({
      root: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('value'),
          description: 'A registered root id or an absolute path; omitted: the project checkout.',
        }),
      ),
      path: Schema.optional(
        Schema.String.annotate({ ...placeRole('value'), description: 'Directory relative to the checkout root; omitted: the root.' }),
      ),
      ignored: Schema.optional(Schema.Boolean.annotate({ description: 'The directory itself is already known ignored.' })),
      limit: limitOf(DIRECTORY),
      cursor: PAGE_CURSOR,
    }),
    refusals: DIRECTORY_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `List ${input.path ?? 'the checkout root'}?` }),
    confirmLabel: 'List directory',
    presentation: {
      running: 'Listing a directory',
      done: 'Listed a directory',
      many: (count) => `Listed ${count} directories`,
    },
  }),
};

export const TREE_FEED = feed('tree.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    root: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  }),
  event: TreeFrame,
  refusals: [...PLACE_REFUSALS],
  callers: 'operator',
  admission: 'project',
});
