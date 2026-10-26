import { Schema } from 'effect';
import { BlockName } from './references.js';
import { tagsField } from './fields.js';
import type { TagReading } from './tags/reading.js';
import type { Tagged } from './tags/roles.js';
import { HOLDER } from './tags/holder.js';
import { SPEC } from './tags/spec.js';

export type WorkStart = 'take' | 'build';

export const workStart = (table: TagReading, node: Tagged): WorkStart | null =>
  table.isTerminal(node) ? null : table.supports(node, HOLDER) ? 'take' : table.supports(node, SPEC) ? 'build' : null;

//! A page is what one Work tab shows before "Show more"; the ceiling bounds one SQL page per graph copy.
export const THREAD_WORK_ROWS = 50;
export const THREAD_WORK_CEILING = 200;

export const THREAD_ACTS = ['created', 'edited', 'finished', 'closed'] as const;
export type ThreadAct = (typeof THREAD_ACTS)[number];

export const workCopySchema = Schema.Struct({
  projectId: Schema.Number,
  project: Schema.String,
  branch: Schema.NullOr(Schema.String),
});
export type WorkCopy = typeof workCopySchema.Type;

export const unreadCopySchema = Schema.Struct({ projectId: Schema.Number, checkout: Schema.String, reason: Schema.String });

const workBlockFields = {
  copy: Schema.Number.annotate({ description: 'The index of the block’s graph copy in `copies`.' }),
  name: BlockName,
  title: Schema.String,
  tags: tagsField,
  status: Schema.NullOr(Schema.String),
};

export const heldWorkSchema = Schema.Struct({
  ...workBlockFields,
  spec: Schema.NullOr(Schema.Struct({ name: BlockName, title: Schema.String, tags: tagsField })),
});
export type HeldWorkRow = typeof heldWorkSchema.Type;

export const didBlockSchema = Schema.Struct({
  ...workBlockFields,
  acts: Schema.Array(Schema.Literals(THREAD_ACTS)),
  last: Schema.Literals(THREAD_ACTS),
  at: Schema.String,
  commit: Schema.NullOr(Schema.String),
  commitUnread: Schema.NullOr(Schema.String).annotate({
    description: 'Why the journal row of the ending could not be read, so its commit stays unknown.',
  }),
  trashed: Schema.Boolean,
});
export type DidBlockRow = typeof didBlockSchema.Type;

export const threadWorkSchema = Schema.Struct({
  copies: Schema.Array(workCopySchema),
  unread: Schema.Array(unreadCopySchema),
  works: Schema.Array(heldWorkSchema),
  did: Schema.Array(didBlockSchema),
  total: Schema.Number,
  next: Schema.NullOr(Schema.String),
});
export type ThreadWork = typeof threadWorkSchema.Type;
