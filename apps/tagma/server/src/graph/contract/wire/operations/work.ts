import { Schema, SchemaAST } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { startPriceSchema } from '../../../../platform/contract/wire/start.js';
import { graphArms as arms } from '../answers.js';
import { blockResultFields, crowdedSchema, idleSpecSchema, overviewFields } from '../answers.js';
import { amendmentOpSchema, batchCreateOpSchema, batchRefSchema, BATCH_OPERATION_ID_HELP } from '../batch.js';
import { blockRef, body, fieldsField, filePath, line, tagsField } from '../fields.js';
import { sourceInputSchema } from '../sources.js';
import { SOURCE_OPERATIONS } from './sources.js';
import type { Raised } from '@runlith/agent/permissions';
import { claimRaises, graphInput, GRAPH_ACT, GRAPH_WORK_APPROVAL, noSubjects, workRaises } from './shared.js';
import { WRITE_OPERATIONS } from './writes.js';

const createGrammar = Object.entries(batchCreateOpSchema.fields)
  .map(([name, field]) => `${name}${SchemaAST.isOptional(field.ast) ? '?' : ''}`)
  .join(', ');

const APPLY_GRAMMAR = `${BATCH_OPERATION_ID_HELP}
Exact fields per op (?, optional):
  create    {${createGrammar}}
  update    {op, id, title?, body?, status?, tags?, parentId?, ord?, fields?}
  edit      {op, id, old, new, all?}
  claim     {op, id}
  release   {op, id}
  finish    {op, id, commit?}
  close     {op, id, reason?}
  link      {op, fromId, kind, toId}
  unlink    {op, fromId, kind, toId}
  anchor    {op, blockId, kind, ref, symbol?, fromId?}
  unanchor  {op, blockId, kind, ref, symbol?}
  supersede {op, oldId, withId}
  unsupersede {op, id}
  delete    {op, id}
  restore   {op, id}
  propose   {op, $id?, amendsId, title, body?, ops, sources?}
  accept    {op, id, reason?}
  reject    {op, id, reason}
  uphold    {op, id, reason, by}
A create inside propose.ops leaves work unheld; claim it after accept.
One writing project per document; individual ops cannot set project. References to blocks being changed, parents, source donors and replacements must stay there; another project refuses place-mismatch. To move a block to a foreign parent, use update_block with parentId alone outside the document. Edge targets may be in any registered project, as in link_blocks/unlink_blocks.
\`$id\` on create/propose declares a handle. Every reference accepts \`$handle\`; bodies use \`[[$handle]]\`. A body and a field naming blocks (a ref field such as a catalog's tags, a view query's scope and edge) reach a create's handle anywhere in the document; an op's own reference (id, parentId, fromId, …) names a handle declared above it. An undeclared handle refuses. Any failed gate rolls back all ops and names the failing op.
Submit a document file, read at call time. An op’s \`body\` may be \`{"file":"name.md"}\`, relative to the document; edit old/new stay inline. On refusal, edit the returned \`inputFile\` and resubmit its path: it names the body file when the body itself was refused, otherwise the document (or a saved copy of inline input).`;

const batchOpSchema = Schema.StructWithRest(
  Schema.Struct({
    op: Schema.String.annotate({
      description:
        'The graph verb: create, update, edit, claim, release, finish, close, link, unlink, anchor, unanchor, supersede, unsupersede, delete, restore, propose, accept, reject or uphold.',
    }),
    tags: Schema.optional(tagsField).annotate({
      description:
        'What the node is: create names it, update replaces the whole set as update_block does. Every value its tags declare rides in `fields`.',
    }),
    fields: Schema.optional(fieldsField).annotate({
      description:
        'The values those tags declare — a #view’s query, a #proposal’s ops, a #research reading’s source — each checked against its declaration.',
    }),
    body: Schema.optional(Schema.Union([body, Schema.Struct({ file: filePath })])).annotate({
      description: 'create, update, propose: the markdown itself, or `{"file": "name.md"}` relative to the document.',
    }),
    by: Schema.optional(Schema.Array(batchRefSchema).check(Schema.isMinLength(1))).annotate({
      description: 'uphold: every answering block, always a list — `["$handle"]` for one.',
    }),
    sources: Schema.optional(Schema.Array(sourceInputSchema)).annotate({ description: 'create, propose: anchors.' }),
    claim: Schema.optional(Schema.Boolean).annotate({ description: 'create: atomically take the new block for the calling session.' }),
    all: Schema.optional(Schema.Boolean).annotate({ description: 'edit: replace every occurrence.' }),
    ord: Schema.optional(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

const WORK_ACTS = {
  claim_block: operation('claim_block', {
    ...GRAPH_ACT,
    meaning:
      'Take a node whose tag binds a holder: sign this session in, moving a node that is not yet in work to its claimed word. Claiming work already in work keeps its word.',
    confirmation: (input) => ({ summary: `Claim ${input.blockId}?` }),
    confirmLabel: 'Claim',
    presentation: { running: 'Claiming a node', done: 'Claimed a node' },
    subjects: noSubjects,
    raises: claimRaises,
    approval: GRAPH_WORK_APPROVAL,
    input: graphInput({ blockId: blockRef }),
    refusals: ['not-found', 'deleted', 'no-holder', 'claimed-elsewhere', 'no-status', 'illegal-status', 'illegal-transition', 'superseded'],
    answer: arms({ ok: blockResultFields }),
  }),

  release_block: operation('release_block', {
    ...GRAPH_ACT,
    meaning:
      'Give a held node back: its initial word, no holder. Use finish_block when the work happened or close_block when it ended without it.',
    confirmation: (input) => ({ summary: `Release ${input.blockId} back to the pool?` }),
    confirmLabel: 'Release',
    presentation: { running: 'Releasing a node', done: 'Released a node' },
    subjects: noSubjects,
    raises: workRaises,
    approval: GRAPH_WORK_APPROVAL,
    input: graphInput({ blockId: blockRef }),
    refusals: ['not-found', 'deleted', 'no-holder', 'not-held', 'no-status', 'illegal-status', 'illegal-transition'],
    answer: arms({ ok: blockResultFields }),
  }),

  finish_block: operation('finish_block', {
    ...GRAPH_ACT,
    meaning: 'End a node at its tag’s done word: the work it stood for happened.',
    confirmation: (input) => ({ summary: `Finish ${input.blockId}?` }),
    confirmLabel: 'Finish',
    presentation: { running: 'Finishing', done: 'Finished' },
    subjects: noSubjects,
    raises: workRaises,
    approval: GRAPH_WORK_APPROVAL,
    grammar: 'A node nobody holds finishes as it stands.\nAny gate failure rolls back the entire act.',
    input: graphInput({
      blockId: blockRef,
      commit: Schema.optional(line).annotate({
        description: 'The commit carrying the work, recorded in the journal.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-closable',
      'no-status',
      'illegal-status',
      'status-operation',
      'illegal-transition',
      'open-children',
      'tag-undeclared',
      'tag-declared',
      'vocabulary-older',
      'tag-incoherent',
      'field-conflict',
      'role-conflict',
      'field-invalid',
      'field-required',
      'field-target',
      'operation-only',
      'project-root',
      'cross-project-parent',
      'leaf',
      'tree-cycle',
      'carriers-invalid',
      'body-capped',
      'body-source',
      'superseded',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  close_block: operation('close_block', {
    ...GRAPH_ACT,
    meaning:
      'End a node at its tag’s closed word: dropped, answered elsewhere, or a spec built or no longer wanted. Supersede non-work kinds instead.',
    confirmation: (input) => ({
      summary: `Close ${input.blockId}?`,
      facts: input.reason === undefined ? undefined : [{ label: 'Reason', value: input.reason }],
    }),
    confirmLabel: 'Close',
    presentation: { running: 'Closing', done: 'Closed' },
    subjects: noSubjects,
    raises: workRaises,
    approval: GRAPH_WORK_APPROVAL,
    input: graphInput({
      blockId: blockRef,
      reason: Schema.optional(line).annotate({
        description: 'Why it ends here.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'superseded',
      'not-closable',
      'open-children',
      'status-operation',
      'no-status',
      'illegal-status',
      'illegal-transition',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  accept_amendment: operation('accept_amendment', {
    ...GRAPH_ACT,
    meaning: 'Execute an amendment’s deferred operations and mark it applied. Created blocks link back with discovered-from.',
    confirmation: (input) => ({
      summary: `Accept amendment ${input.blockId} and run its ops?`,
      consequence: 'Its deferred operations execute now, through every gate.',
    }),
    confirmLabel: 'Accept',
    presentation: { running: 'Accepting an amendment', done: 'Accepted an amendment' },
    subjects: noSubjects,
    grammar:
      'Rechecks all gates; changed target text refuses without applying anything or closing the amendment. To partially accept, merge or amend another author’s amendment, create and accept a derived amendment instead of editing theirs.',
    input: graphInput({
      blockId: blockRef.annotate({ description: 'The amendment.' }),
      reason: Schema.optional(line).annotate({
        description: 'Why it is taken; recorded with the verdict.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-an-amendment',
      'creation-default-missing',
      'creation-default-ambiguous',
      'creation-default-invalid',
      'creation-contract',
      'no-holder',
      'claimed-elsewhere',
      'amendment-outside',
      'amendment-op',
      'amendment-ref',
      'amendment-empty',
      'amends-shape',
      'amends-an-amendment',
      'amendment-shape',
      'verdict-standing',
      'storage-unavailable',
      'stealth-dependency',
      'tree-not-measured',
      'anchor-ambiguous',
      'anchor-noop',
      'batch-ref',
      'body-capped',
      'body-address',
      'carriers-invalid',
      'cross-project',
      'cross-project-parent',
      'parent-required',
      'duplicate-source',
      'edge-shape',
      'catalog-member',
      'edge-undeclared',
      'field-conflict',
      'field-required',
      'field-target',
      'leaf',
      'no-edge',
      'not-measurable',
      'operation-only',
      'project-root',
      'role-conflict',
      'source-outside',
      'source-required',
      'status-operation',
      'superseded',
      'symbol-shape',
      'symbol-missing',
      'tag-declared',
      'vocabulary-older',
      'tag-incoherent',
      'tag-undeclared',
      'tree-cycle',
      'wait-cycle',
      'field-invalid',
      'anchor-not-found',
      'no-status',
      'illegal-status',
      'illegal-transition',
      'retag-status',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  uphold_amendment: operation('uphold_amendment', {
    ...GRAPH_ACT,
    meaning: 'Mark an amendment upheld without running its operations: finished work already answers the finding.',
    confirmation: (input) => ({
      summary: `Uphold amendment ${input.blockId} as already answered?`,
      facts: [
        { label: 'Reason', value: input.reason },
        { label: 'Answered by', value: input.by.join(', ') },
      ],
      consequence: 'Its ops never run; the record says the finding was taken and names what answers it.',
    }),
    confirmLabel: 'Uphold',
    presentation: { running: 'Upholding an amendment', done: 'Upheld an amendment' },
    subjects: noSubjects,
    grammar:
      'Give the reason and all answering blocks, including an accepted derived amendment when applicable. Use for findings fixed in place or merged elsewhere. If work remains, accept the payload or reject the finding instead.',
    input: graphInput({
      blockId: blockRef.annotate({ description: 'The amendment.' }),
      reason: line.annotate({ description: 'Why its payload does not run; recorded with the verdict.' }),
      by: Schema.Array(blockRef).check(Schema.isMinLength(1)).annotate({
        description: 'All finished answers: completed work, standing docs or the accepted derived amendment.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-an-amendment',
      'reason-required',
      'self-answer',
      'cross-project',
      'no-status',
      'illegal-status',
      'illegal-transition',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  revise_amendment: operation('revise_amendment', {
    ...GRAPH_ACT,
    meaning: 'Replace an open amendment’s deferred operations through the original filing gates.',
    confirmation: (input) => ({
      summary: `Revise the payload of amendment ${input.blockId}?`,
      facts: [{ label: 'Operations', value: String(input.ops.length) }],
      consequence: 'The ops a verdict would run are replaced by these.',
    }),
    confirmLabel: 'Revise',
    presentation: { running: 'Revising an amendment', done: 'Revised an amendment' },
    subjects: noSubjects,
    grammar:
      'Decided amendments refuse; derive a new amendment instead. Revise the findings you filed: another author’s finding stays theirs, and a change to it is a derived amendment. This changes the payload only; edit the body separately.',
    input: graphInput({
      blockId: blockRef.annotate({ description: 'The amendment.' }),
      ops: Schema.Array(amendmentOpSchema).check(Schema.isMinLength(1)).annotate({
        description: 'The corrected deferred ops, whole: create | edit | update | delete | link | unlink.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-an-amendment',
      'amendment-shape',
      'creation-default-missing',
      'creation-default-ambiguous',
      'creation-default-invalid',
      'creation-contract',
      'amendment-shape',
      'amendment-op',
      'amendment-ref',
      'amendment-outside',
      'amendment-empty',
      'parent-required',
      'leaf',
      'body-capped',
      'body-address',
      'verdict-standing',
      'illegal-status',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  reject_amendment: operation('reject_amendment', {
    ...GRAPH_ACT,
    meaning: 'Reject an open amendment with a reason. Its deferred operations do not run.',
    confirmation: (input) => ({
      summary: `Reject amendment ${input.blockId}?`,
      facts: [{ label: 'Reason', value: input.reason }],
      consequence: 'Its ops never run; the reason is what the next review reads.',
    }),
    confirmLabel: 'Reject',
    presentation: { running: 'Rejecting an amendment', done: 'Rejected an amendment' },
    subjects: noSubjects,
    input: graphInput({
      blockId: blockRef.annotate({ description: 'The amendment.' }),
      reason: line.annotate({ description: 'Why it is declined.' }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-an-amendment',
      'amendment-shape',
      'reason-required',
      'no-status',
      'illegal-status',
      'illegal-transition',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  supersede_block: operation('supersede_block', {
    ...GRAPH_ACT,
    meaning:
      'Retire an obsolete block in favor of its successor, preserving history with a supersedes edge. Do not delete obsolete knowledge.',
    confirmation: (input) => ({
      summary: `Supersede ${input.oldId} with ${input.withId}?`,
      consequence: `${input.oldId} becomes superseded — settled truth included — and stops being live knowledge.`,
    }),
    confirmLabel: 'Supersede',
    presentation: { running: 'Superseding a block', done: 'Superseded a block' },
    subjects: noSubjects,
    raises: workRaises,
    approval: GRAPH_WORK_APPROVAL,
    grammar:
      'Returns referencing blocks; re-read and update their references to the successor. A replaced block that stood in work leaves it: its hold ends with the replacement, and another session’s hold ends on the operator’s word.',
    input: graphInput({
      oldId: blockRef.annotate({ description: 'The block being replaced.' }),
      withId: blockRef.annotate({ description: 'The block that takes its place.' }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'self-supersede',
      'already-superseded',
      'successor-superseded',
      'field-invalid',
      'cross-project',
      'operation-only',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  unsupersede_block: operation('unsupersede_block', {
    ...GRAPH_ACT,
    meaning:
      'Bring a replaced block back to stand: remove the retirement edge and restore the block with its references, sources and status intact. For a replacement taken in error, or to correct the replaced record itself — then supersede_block retires it again, in one apply_batch when it must not stand meanwhile.',
    confirmation: (input) => ({
      summary: `Withdraw the replacement that retired ${input.blockId}?`,
      consequence: 'It stands again as it stood, and its successor keeps everything it says.',
    }),
    confirmLabel: 'Withdraw',
    presentation: { running: 'Withdrawing a replacement', done: 'Withdrew a replacement' },
    subjects: noSubjects,
    grammar: 'Leaves the successor and other replacement-chain links unchanged. Refuses a block that was not replaced.',
    input: graphInput({
      blockId: blockRef.annotate({ description: 'The replaced block, which stands again.' }),
    }),
    refusals: ['not-found', 'deleted', 'not-superseded'],
    answer: arms({ ok: blockResultFields }),
  }),
};

type RefusalOf<T> = T extends Readonly<Record<string, { readonly refusals: readonly (infer Code)[] }>> ? Code : never;

const refusalsOf = <const Families extends readonly Readonly<Record<string, { readonly refusals: readonly string[] }>>[]>(
  ...families: Families
): readonly RefusalOf<Families[number]>[] =>
  [...new Set(families.flatMap((family) => Object.values(family).flatMap((entry) => entry.refusals)))] as never;

const BATCH_REFUSALS = [
  ...(['bad-document', 'batch-shape', 'batch-ref', 'batch-source', 'body-source', 'global-missing'] as const),
  ...refusalsOf(WORK_ACTS, WRITE_OPERATIONS, SOURCE_OPERATIONS),
];

export const WORK_OPERATIONS = {
  ...WORK_ACTS,
  apply_batch: operation('apply_batch', {
    ...GRAPH_ACT,
    deadline: 'large',
    meaning:
      'Apply graph operations atomically in one project (current by default). Use for connected subtrees and bulk changes; any failed gate rolls back the batch.',
    confirmation: (input) => ({
      summary:
        input.file !== undefined
          ? `Apply the batch source ${input.file}?`
          : input.source !== undefined
            ? 'Apply the inline batch document?'
            : `Apply ${input.ops?.length ?? 0} graph operations?`,
      consequence: 'All or nothing: one refused gate rolls back the whole document.',
    }),
    confirmLabel: 'Apply',
    presentation: { running: 'Applying a batch', done: 'Applied a batch' },
    subjects: noSubjects,
    raises: workRaises,
    approval: GRAPH_WORK_APPROVAL,
    grammar: APPLY_GRAMMAR,
    input: graphInput({
      file: Schema.optional(filePath).annotate({
        description:
          'Document path, absolute or caller-relative (agent scratch). Read at call time. Mutually exclusive with source and ops.',
      }),
      source: Schema.optional(Schema.String).annotate({
        description: 'Exact inline batch document text. Mutually exclusive with file and ops.',
      }),
      ops: Schema.optional(
        Schema.Array(batchOpSchema).check(Schema.isMinLength(1)).annotate({
          description:
            'Ordered operations; a document file or source is `{"ops": [...]}` of these same items. Mutually exclusive with file and source; see the batch field grammar above.',
        }),
      ),
    }),
    refusals: BATCH_REFUSALS,
    answer: arms({
      ok: {
        ...overviewFields,
        ids: Schema.Record(Schema.String, Schema.String),
        specs: Schema.optional(Schema.Array(idleSpecSchema)),
        crowded: Schema.optional(Schema.Array(crowdedSchema)),
        start: Schema.optional(startPriceSchema),
      },
    }),
  }),
};
