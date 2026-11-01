import { Schema } from 'effect';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { graphReportFields } from './answers.js';
import { BlockIdentity, BlockName } from './references.js';

const unreadableCopySchema = Schema.Struct({
  projectId: Schema.Number,
  checkout: Schema.String,
  branch: Schema.NullOr(Schema.String),
  names: Schema.Array(BlockName),
  error: refusalSchema,
});

export type UnreadableCopy = typeof unreadableCopySchema.Type;

const locatedTitleSchema = Schema.Struct({
  name: BlockName,
  shortName: BlockName,
  identity: BlockIdentity,
  rowKey: Schema.optional(Schema.Number),
  title: Schema.String,
  projectId: Schema.Number,
  branch: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: 'A different graph copy: null selects the canonical checkout, a name selects that branch; omitted keeps the current copy.',
  }),
});

export type LocatedTitle = typeof locatedTitleSchema.Type;

export const titleReadingSchema = Schema.Struct({
  ...graphReportFields,
  titles: Schema.Array(locatedTitleSchema),
  unreadable: Schema.Array(unreadableCopySchema),
});

export type TitleReading = typeof titleReadingSchema.Type;
