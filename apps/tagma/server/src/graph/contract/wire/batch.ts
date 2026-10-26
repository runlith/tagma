import { Schema } from 'effect';
import { SOURCE_KINDS, sourceInputSchema } from './sources.js';
import { edgeNameSchema } from './edges.js';
import { creationFields } from './creation.js';

import { body, documentRef, fieldsField, line, oldText, place, tagsField, title } from './fields.js';

export const batchRefSchema = documentRef;

export type BatchRef = typeof batchRefSchema.Type;

export const BATCH_OPERATION_ID_HELP =
  'Batch operations use their own reference fields: update/edit/claim/release/finish/close/delete/restore/accept/reject/uphold use `id` (not a standalone tool’s `blockId`); anchor/unanchor use `blockId`; link/unlink use `fromId` and `toId`; supersede uses `oldId` and `withId`. Every reference accepts a block name or `$handle`.';

export const batchCreateOpSchema = Schema.Struct({
  op: Schema.Literal('create'),
  $id: Schema.optional(Schema.String),
  ...creationFields(batchRefSchema, batchRefSchema),
});
type BatchCreateOp = typeof batchCreateOpSchema.Type;
const { claim: _claim, ...deferredFields } = batchCreateOpSchema.fields;
const amendmentCreateOpSchema = Schema.Struct(deferredFields);

export const updateOpSchema = Schema.Struct({
  op: Schema.Literal('update'),
  id: batchRefSchema,
  title: Schema.optional(title),
  body: Schema.optional(body),
  status: Schema.optional(Schema.String),
  tags: Schema.optional(tagsField),
  parentId: Schema.optional(batchRefSchema),
  ord: Schema.optional(Schema.Number),
  fields: Schema.optional(fieldsField),
});
export const editOpSchema = Schema.Struct({
  op: Schema.Literal('edit'),
  id: batchRefSchema,
  old: oldText,
  new: body,
  all: Schema.optional(Schema.Boolean),
});
export const deleteOpSchema = Schema.Struct({ op: Schema.Literal('delete'), id: batchRefSchema });
export const linkOpSchema = Schema.Struct({
  op: Schema.Literal('link'),
  fromId: batchRefSchema,
  kind: edgeNameSchema,
  toId: batchRefSchema,
});
export const unlinkOpSchema = Schema.Struct({
  op: Schema.Literal('unlink'),
  fromId: batchRefSchema,
  kind: edgeNameSchema,
  toId: batchRefSchema,
});

export const AMENDMENT_OPS = ['create', 'edit', 'update', 'delete', 'link', 'unlink'] as const;
const AMENDMENT_VERBS = Schema.Union([editOpSchema, updateOpSchema, deleteOpSchema, linkOpSchema, unlinkOpSchema]).pipe(
  Schema.toTaggedUnion('op'),
);
export const amendmentOpSchema = Schema.Union([amendmentCreateOpSchema, AMENDMENT_VERBS]);
export type AmendmentOp = typeof amendmentOpSchema.Type;

export const claimOpSchema = Schema.Struct({ op: Schema.Literal('claim'), id: batchRefSchema });
export const releaseOpSchema = Schema.Struct({ op: Schema.Literal('release'), id: batchRefSchema });
export const finishOpSchema = Schema.Struct({
  op: Schema.Literal('finish'),
  id: batchRefSchema,
  commit: Schema.optional(line),
});
export const closeOpSchema = Schema.Struct({
  op: Schema.Literal('close'),
  id: batchRefSchema,
  reason: Schema.optional(line),
});
export const anchorOpSchema = Schema.Struct({
  op: Schema.Literal('anchor'),
  blockId: batchRefSchema,
  kind: Schema.Literals(SOURCE_KINDS),
  ref: place,
  symbol: Schema.optional(place),
  fromId: Schema.optional(batchRefSchema),
});
export const unanchorOpSchema = Schema.Struct({
  op: Schema.Literal('unanchor'),
  blockId: batchRefSchema,
  kind: Schema.Literals(SOURCE_KINDS),
  ref: place,
  symbol: Schema.optional(place),
});
export const supersedeOpSchema = Schema.Struct({ op: Schema.Literal('supersede'), oldId: batchRefSchema, withId: batchRefSchema });
export const restoreOpSchema = Schema.Struct({ op: Schema.Literal('restore'), id: batchRefSchema });

type GraphMutationOp =
  | BatchCreateOp
  | typeof updateOpSchema.Type
  | typeof editOpSchema.Type
  | typeof claimOpSchema.Type
  | typeof releaseOpSchema.Type
  | typeof finishOpSchema.Type
  | typeof closeOpSchema.Type
  | typeof linkOpSchema.Type
  | typeof unlinkOpSchema.Type
  | typeof anchorOpSchema.Type
  | typeof unanchorOpSchema.Type
  | typeof supersedeOpSchema.Type
  | typeof deleteOpSchema.Type
  | typeof restoreOpSchema.Type;

export const proposeOpSchema = Schema.Struct({
  op: Schema.Literal('propose'),
  $id: Schema.optional(Schema.String),
  amendsId: batchRefSchema,
  title,
  body: Schema.optional(body),
  ops: Schema.Array(amendmentOpSchema).check(Schema.isMinLength(1)),
  sources: Schema.optional(Schema.Array(sourceInputSchema)),
});
export const acceptOpSchema = Schema.Struct({ op: Schema.Literal('accept'), id: batchRefSchema, reason: Schema.optional(line) });
export const rejectOpSchema = Schema.Struct({ op: Schema.Literal('reject'), id: batchRefSchema, reason: line });
export const upholdOpSchema = Schema.Struct({
  op: Schema.Literal('uphold'),
  id: batchRefSchema,
  reason: line,
  by: Schema.Array(batchRefSchema).check(Schema.isMinLength(1)),
});

const BATCH_VERBS = Schema.Union([
  updateOpSchema,
  editOpSchema,
  claimOpSchema,
  releaseOpSchema,
  finishOpSchema,
  closeOpSchema,
  linkOpSchema,
  unlinkOpSchema,
  anchorOpSchema,
  unanchorOpSchema,
  supersedeOpSchema,
  deleteOpSchema,
  restoreOpSchema,
  proposeOpSchema,
  acceptOpSchema,
  rejectOpSchema,
  upholdOpSchema,
]).pipe(Schema.toTaggedUnion('op'));

export const batchOpSchema = Schema.Union([batchCreateOpSchema, BATCH_VERBS]);
export const batchSchema = Schema.Struct({ ops: Schema.Array(batchOpSchema).check(Schema.isMinLength(1)) });
export const batchInputSchema = Schema.Struct({
  file: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  source: Schema.optional(Schema.String),
});
export type BatchInput = typeof batchInputSchema.Type;
export type BatchOp =
  | GraphMutationOp
  | typeof proposeOpSchema.Type
  | typeof acceptOpSchema.Type
  | typeof rejectOpSchema.Type
  | typeof upholdOpSchema.Type;

export function batchSource(ops: readonly unknown[]): string {
  return `${JSON.stringify({ ops }, null, 2)}\n`;
}

export function batchDocument(ops: readonly unknown[]): BatchInput {
  return { source: batchSource(ops) };
}
