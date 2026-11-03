import { Schema } from 'effect';
import { feedSchema } from './feed.js';
import { installedSchema, installingSchema } from './next.js';
import { placementSchema } from './placement.js';

export const updateRecordSchema = Schema.Struct({
  feed: Schema.NullOr(feedSchema),
  installing: Schema.NullOr(installingSchema),
  installed: Schema.NullOr(installedSchema),
  took: Schema.NullOr(Schema.Number),
  placement: Schema.optional(placementSchema),
});
