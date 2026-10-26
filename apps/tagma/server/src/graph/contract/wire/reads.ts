import { PageCursor } from '@runlith/paging';
import { Schema } from 'effect';
import { fieldsField, tagsField } from './fields.js';
import { BlockName } from './references.js';
import { nodeActionsSchema } from './tags/actions.js';

export const pageFacts = {
  shown: Schema.Number,
  total: Schema.Number,
  next: Schema.NullOr(PageCursor),
  complete: Schema.Boolean,
};

export const blockListRowSchema = Schema.Struct({
  name: BlockName,
  tags: tagsField,
  fields: fieldsField,
  actions: nodeActionsSchema,
  title: Schema.String,
  snippet: Schema.String,
  parentTitle: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  superseded: Schema.optional(Schema.Boolean),
  blocked: Schema.optional(Schema.Boolean),
  building: Schema.optional(Schema.Boolean),
  answered: Schema.optional(Schema.Boolean),
});
export type BlockListRow = typeof blockListRowSchema.Type;

export const blockPageSchema = Schema.Struct({
  items: Schema.Array(blockListRowSchema),
  total: Schema.Number,
});
export type BlockPage = typeof blockPageSchema.Type;

export const queryPageSchema = Schema.Struct({ ...blockPageSchema.fields, ...pageFacts });
export type QueryPageBody = typeof queryPageSchema.Type;

export type SearchHit = BlockListRow;

export const viewResultsSchema = Schema.Struct({
  items: Schema.Array(blockListRowSchema),
  total: Schema.Number,
  missingScope: Schema.Array(Schema.String),
});
export type ViewResults = typeof viewResultsSchema.Type;

export const searchPageSchema = Schema.Struct({
  items: Schema.Array(blockListRowSchema),
  total: Schema.Number,
  nextCursor: Schema.NullOr(PageCursor),
  approximate: Schema.Boolean,
});
export type SearchPage = typeof searchPageSchema.Type;

export const searchWirePageSchema = queryPageSchema;

export const BLOCK_CHANGE_KINDS = [
  'anchor',
  'unanchor',
  'relocate',
  'link',
  'unlink',
  'supersede',
  'unsupersede',
  'delete',
  'restore',
  'enable',
  'disable',
  'enforce',
  'remeasure',
  'accept',
  'reject',
  'uphold',
  'revise',
  'settle',
  'answer',
  'unanswer',
  'move',
  'fields',
] as const;
export type BlockChangeKind = (typeof BLOCK_CHANGE_KINDS)[number];

export const blockChangeSchema = Schema.Struct({
  kind: Schema.Literals(BLOCK_CHANGE_KINDS),
  label: Schema.String,
  peerName: Schema.NullOr(BlockName),
});
export type BlockChange = typeof blockChangeSchema.Type;

export const blockDiffSchema = Schema.Struct({
  blockName: BlockName,
  from: Schema.Number,
  to: Schema.Number,
  entries: Schema.Number,
  sessions: Schema.Array(Schema.NullOr(Schema.Number)),
  ops: Schema.Array(Schema.String),
  body: Schema.NullOr(Schema.String),
  bodyUnknown: Schema.Boolean,
  bodySize: Schema.NullOr(Schema.Struct({ from: Schema.Number, to: Schema.Number })),
  title: Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String })),
  status: Schema.NullOr(Schema.Struct({ from: Schema.NullOr(Schema.String), to: Schema.String })),
  tag: Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String })),
  changes: Schema.Array(blockChangeSchema),
});
export type BlockDiff = typeof blockDiffSchema.Type;

export const MARK_KINDS = ['added', 'deleted', 'restored', 'moved', 'edited'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const blockMarkSchema = Schema.Struct({
  blockName: BlockName,
  mark: Schema.Literals(MARK_KINDS),
  entries: Schema.Number,
  sessions: Schema.Array(Schema.NullOr(Schema.Number)),
});
export type BlockMark = typeof blockMarkSchema.Type;
