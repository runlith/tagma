import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { blockResultFields } from '../answers.js';
import { blockMention, blockRef, body, fieldsField, filePath, oldText, tagsField, title } from '../fields.js';
import { edgeNameSchema } from '../edges.js';
import { BODY_FILE_FIELD, GRAPH_ACT, GRAPH_DIRECT_ACT, noSubjects, graphInput } from './shared.js';
import { creationFields } from '../creation.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';

const CREATE_GRAMMAR = `An untagged note may carry file, directory or symbol sources, which support ownership and navigation, and the edges every block carries: \`relates\` and \`discovered-from\`. To deliver a note to file readers and writers, use a type supporting \`core/explanation\`. What a tagged node carries — its fields, edges, sources and the word it is born at — is its tags' declaration in your instructions; a proposal is born under \`amendsId\` with deferred \`ops\` (create/edit/update/delete/link/unlink) restricted to that subtree, and a move amends the moving block.`;

const deleteBlockConsequence = (): string => 'The subtree disappears from every live read until it is restored.';

export const WRITE_OPERATIONS = {
  create_block: operation('create_block', {
    ...GRAPH_DIRECT_ACT,
    meaning:
      'Create a block with optional sources. Without parentId, uses the selected project root. With claim: true, atomically take the new block for the calling session through its declared holder lifecycle.',
    grammar: `${CREATE_GRAMMAR} \`checkout\` selects the graph copy where the block is born.`,
    input: graphInput({
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'The registered checkout whose graph receives the new block.',
      }),
      ...creationFields(blockRef, blockMention),
      bodyFile: Schema.optional(filePath).annotate({ description: BODY_FILE_FIELD }),
    }),
    refusals: [
      'tag-undeclared',
      'creation-default-missing',
      'creation-default-ambiguous',
      'creation-default-invalid',
      'creation-contract',
      'no-holder',
      'claimed-elsewhere',
      'no-status',
      'illegal-status',
      'illegal-transition',
      'carriers-invalid',
      'tag-declared',
      'vocabulary-older',
      'tag-incoherent',
      'field-conflict',
      'role-conflict',
      'field-invalid',
      'field-required',
      'field-target',
      'source-required',
      'operation-only',
      'amends-missing',
      'amends-shape',
      'tree-not-measured',
      'leaf',
      'edge-undeclared',
      'edge-shape',
      'wait-cycle',
      'cross-project',
      'superseded',
      'duplicate-source',
      'amends-an-amendment',
      'amendment-empty',
      'amendment-ref',
      'amendment-op',
      'amendment-outside',
      'amendment-shape',
      'cross-project-parent',
      'storage-unavailable',
      'stealth-dependency',
      'project-root',
      'no-root',
      'source-outside',
      'not-measurable',
      'symbol-shape',
      'symbol-missing',
      'body-capped',
      'body-address',
      'body-source',
      'place-mismatch',
      'unknown-project',
      'ambiguous-project',
      'global-missing',
      'no-home',
      'not-found',
      'deleted',
      'scope-outside-project',
      'root-unproven',
    ],
    answer: arms({ ok: blockResultFields }),
    confirmation: (input) => ({
      summary: `Create the ${(input.tags ?? []).map((tag: string) => `#${tag}`).join(' ') || 'note'} “${input.title}”?`,
      facts:
        input.sources === undefined || input.sources.length === 0
          ? undefined
          : [
              {
                label: 'Sources',
                value: input.sources
                  .map(
                    (one: { readonly ref: string; readonly symbol?: string }) =>
                      `${one.ref}${one.symbol === undefined ? '' : `#${one.symbol}`}`,
                  )
                  .join(', '),
              },
            ],
    }),
    confirmLabel: 'Create',
    presentation: { running: 'Creating a block', done: 'Created a block' },
    subjects: noSubjects,
  }),

  update_block: operation('update_block', {
    ...GRAPH_ACT,
    meaning: 'Update a block’s title, whole body, status or tags, and the fields its tags declare.',
    grammar: `\`body\` replaces all text; use edit_block for partial edits safe against concurrent changes.
Statuses are the words the node’s own tag declares. Other tags have no status.
\`fields\` writes over the named values and leaves the rest; \`null\` drops a value. The status and each field the tag’s declaration names with an operation are that operation’s.
\`tags\` replaces what the node is and keeps its name, place, edges, sources and references: the node starts at the new tags’ initial status, as if born, so only a node at its initial status with no holder changes tags. Every value, source and edge it carries must hold under the new tags, and the call names as null each value they do not declare. With \`tags: []\`, file, directory and symbol sources and \`relates\` and \`discovered-from\` edges remain valid.
Title/body changes return referencing blocks; re-read and correct them.
A \`parentId\` in another project’s graph moves the block with its subtree and carries no other change: names, statuses, holders, every field — operation-owned ones included — and sources stay; the new graph judges each block by its own tags. Edges inside the subtree stay, edges across its edge become cross-project edges, and edges of other projects into it follow it. A rule and the task or spec owning its debt move together; a running rule's inspection must be declared in the new project; module relations across the edge are dropped, and both module maps must still hold.`,
    input: graphInput({
      blockId: blockRef,
      title: Schema.optional(title),
      body: Schema.optional(body),
      bodyFile: Schema.optional(filePath).annotate({ description: BODY_FILE_FIELD }),
      status: Schema.optional(Schema.String).annotate({
        description:
          "A move no operation owns — an intermediate word or a reopen; the tag's status line names the operation of every other move.",
      }),
      tags: Schema.optional(tagsField).annotate({
        description: 'The whole new set of tags, replacing the standing one; `[]` makes an untagged note.',
      }),
      fields: Schema.optional(fieldsField).annotate({
        description:
          'The values this node’s tags declare, corrected — a view’s query and layout, a reflection’s three facts, a research reading’s source. null drops one.',
      }),
      parentId: Schema.optional(Schema.NullOr(blockMention)).annotate({
        description:
          'The new parent. A parent in another project’s graph moves the block there with its subtree, each block under the same name. Null moves to the project root; omit to leave the parent unchanged.',
      }),
      ord: Schema.optional(Schema.Number).annotate({
        description: 'Position among siblings, ascending.',
      }),
    }),
    refusals: [
      'not-found',
      'illegal-status',
      'illegal-transition',
      'no-status',
      'status-operation',
      'operation-only',
      'field-invalid',
      'field-required',
      'field-target',
      'carriers-invalid',
      'tag-incoherent',
      'field-conflict',
      'role-conflict',
      'tag-declared',
      'vocabulary-older',
      'project-root',
      'cross-project-parent',
      'relocation-shape',
      'tag-undeclared',
      'creation-default-missing',
      'creation-default-ambiguous',
      'creation-default-invalid',
      'creation-contract',
      'no-holder',
      'claimed-elsewhere',
      'edge-undeclared',
      'edge-shape',
      'wait-cycle',
      'cross-project',
      'amends-missing',
      'amends-shape',
      'tree-not-measured',
      'no-root',
      'source-required',
      'source-outside',
      'duplicate-source',
      'not-measurable',
      'symbol-shape',
      'symbol-missing',
      'catalog-member',
      'relocation-unfinished',
      'relocation-stale',
      'inspection-unknown',
      'inspection-failed',
      'module-map-invalid',
      'leaf',
      'tree-cycle',
      'body-capped',
      'body-address',
      'body-source',
      'superseded',
      'deleted',
      'retag-status',
      'not-measurable',
      'amends-shape',
      'amendment-empty',
      'amendment-op',
      'amendment-ref',
      'amendment-outside',
      'amends-an-amendment',
      'amendment-shape',
      'verdict-standing',
      'storage-unavailable',
      'stealth-dependency',
    ],
    answer: arms({ ok: blockResultFields }),
    confirmation: (input) => ({
      summary: input.parentId === undefined && input.ord === undefined ? `Update ${input.blockId}?` : `Update and move ${input.blockId}?`,
      facts: [
        ...(input.tags === undefined
          ? []
          : [{ label: 'Tags', value: input.tags.map((tag: string) => `#${tag}`).join(' ') || '(untagged note)' }]),
        ...(input.title === undefined ? [] : [{ label: 'Title', value: input.title }]),
        ...(input.body === undefined ? [] : [{ label: 'Body', value: input.body }]),
        ...(input.status === undefined ? [] : [{ label: 'Status', value: input.status }]),
        ...(input.parentId === undefined ? [] : [{ label: 'Parent', value: input.parentId === null ? '(project root)' : input.parentId }]),
        ...(input.ord === undefined ? [] : [{ label: 'Position', value: String(input.ord) }]),
        ...(input.fields === undefined
          ? []
          : [
              {
                label: 'Fields',
                value: Object.entries(input.fields)
                  .map(([key, value]) => `${key} ${Array.isArray(value) ? `(${value.join(', ')})` : String(value)}`)
                  .join(' · '),
              },
            ]),
      ],
    }),
    confirmLabel: 'Update',
    presentation: { running: 'Updating a block', done: 'Updated a block' },
    subjects: noSubjects,
  }),

  edit_block: operation('edit_block', {
    ...GRAPH_DIRECT_ACT,
    meaning: 'Replace exact text within a block body; an empty replacement deletes it.',
    grammar:
      'Read the block first. Match bytes exactly, including whitespace and line breaks; multiple matches require `replaceAll`. A mismatch may mean concurrent edits: re-read, do not bypass it with a whole-body overwrite.',
    input: graphInput({
      blockId: blockRef,
      oldString: oldText.annotate({ description: 'The exact text to replace, as stored.' }),
      newString: body.annotate({ description: 'What replaces it. Empty deletes the anchored text.' }),
      replaceAll: Schema.optional(Schema.Boolean).annotate({
        description: 'Replace every occurrence instead of refusing an ambiguous anchor.',
      }),
    }),
    refusals: [
      'not-found',
      'anchor-empty',
      'anchor-not-found',
      'anchor-ambiguous',
      'anchor-noop',
      'body-capped',
      'body-address',
      'superseded',
      'deleted',
      'tag-declared',
      'vocabulary-older',
      'tag-incoherent',
      'carriers-invalid',
      'field-conflict',
      'role-conflict',
      'field-invalid',
      'field-required',
      'field-target',
      'operation-only',
      'no-status',
      'illegal-status',
      'illegal-transition',
      'status-operation',
      'project-root',
      'cross-project-parent',
      'leaf',
      'tree-cycle',
    ],
    answer: arms({ ok: blockResultFields }),
    confirmation: (input) => ({
      summary: `Edit ${input.blockId}?`,
      facts: [
        { label: 'Replace', value: input.oldString },
        { label: 'With', value: input.newString === '' ? '(delete)' : input.newString },
      ],
    }),
    confirmLabel: 'Edit',
    presentation: { running: 'Editing a block', done: 'Edited a block' },
    subjects: noSubjects,
  }),

  link_blocks: operation('link_blocks', {
    ...GRAPH_ACT,
    meaning: 'Add a typed edge between blocks.',
    grammar:
      '`kind` is `relates` or `discovered-from`, which every block carries — an untagged note included — or an edge a tag of the FROM block declares; a tag declaring targets for an edge narrows where its blocks point along it. `discovered-from` points at a block’s origin. `waits-on` points from waiting work to its blocker and affects readiness. `supersedes` and `amends` belong to their lifecycle operations. A TO block in another project is linked into its graph: the edge lives in the FROM graph and names that graph by its root, so a colleague’s clone resolves it too.',
    input: graphInput({
      fromId: blockRef.annotate({ description: 'For "waits-on": the work that waits.' }),
      kind: edgeNameSchema,
      toId: blockMention.annotate({ description: 'The block linked to, in this project or another one of this machine.' }),
    }),
    refusals: ['not-found', 'deleted', 'edge-shape', 'edge-undeclared', 'operation-only', 'wait-cycle', 'superseded', 'no-root'],
    answer: arms({ ok: {} }),
    confirmation: (input) => ({ summary: `Link ${input.fromId} — ${input.kind} → ${input.toId}?` }),
    confirmLabel: 'Link',
    presentation: { running: 'Linking blocks', done: 'Linked blocks' },
    subjects: noSubjects,
  }),

  unlink_blocks: operation('unlink_blocks', {
    ...GRAPH_ACT,
    meaning: 'Remove a typed edge between blocks. Lifecycle-owned edges require their own operations.',
    grammar:
      'An edge into another project is unlinked by the name its read printed, whether that project is on this machine or not; the act is recorded in the FROM graph. A block the edge reaches under several graph addresses loses every one of them.',
    input: graphInput({
      fromId: blockRef,
      kind: edgeNameSchema,
      toId: blockMention,
    }),
    refusals: ['not-found', 'deleted', 'edge-shape', 'no-edge', 'operation-only', 'ambiguous-name', 'no-root'],
    answer: arms({ ok: {} }),
    confirmation: (input) => ({ summary: `Remove the ${input.kind} edge ${input.fromId} → ${input.toId}?` }),
    confirmLabel: 'Unlink',
    presentation: { running: 'Unlinking blocks', done: 'Unlinked blocks' },
    subjects: noSubjects,
  }),

  delete_block: operation('delete_block', {
    ...GRAPH_ACT,
    meaning: 'Move a block and its subtree to trash as one journalled batch. To replace obsolete knowledge, supersede it instead.',
    input: graphInput({ blockId: blockRef }),
    refusals: [
      'not-found',
      'deleted',
      'project-root',
      'catalog-member',
      'field-invalid',
      'parent-deleted',
      'carriers-invalid',
      'operation-only',
    ],
    answer: arms({ ok: blockResultFields }),
    confirmation: (input) => ({
      summary: `Move ${input.blockId} and everything under it to the trash?`,
      consequence: deleteBlockConsequence(),
    }),
    confirmLabel: 'Delete',
    intent: 'destructive',
    destructiveConsequence: deleteBlockConsequence,
    presentation: { running: 'Moving a block to the trash', done: 'Moved a block to the trash' },
    subjects: noSubjects,
  }),

  restore_block: operation('restore_block', {
    ...GRAPH_ACT,
    meaning: 'Restore the exact subtree deleted together, addressed by its trash root.',
    grammar:
      'A name that is not a trash root of this project refuses and lists the available roots; a name a live block holds refuses naming its project. Ordinary block reads cannot read deleted blocks.',
    input: graphInput({ blockId: blockRef }),
    refusals: [
      'not-found',
      'not-in-trash',
      'not-deleted',
      'parent-deleted',
      'journal-unreadable',
      'carriers-invalid',
      'field-invalid',
      'operation-only',
    ],
    answer: arms({ ok: blockResultFields }),
    confirmation: (input) => ({ summary: `Restore ${input.blockId} from the trash?` }),
    confirmLabel: 'Restore',
    presentation: { running: 'Restoring from the trash', done: 'Restored from the trash' },
    subjects: noSubjects,
  }),
};
