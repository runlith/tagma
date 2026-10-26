import { Schema } from 'effect';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { graphReportFields } from './answers.js';
import { BlockName } from './references.js';

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
