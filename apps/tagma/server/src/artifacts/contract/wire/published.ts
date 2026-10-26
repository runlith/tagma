import { Schema } from 'effect';
import { artifactIdSchema } from './artifacts.js';
import { timelineSchema } from './timeline.js';

export const PUBLISH_TOOL = 'publish_artifact';

export const publishedPageSchema = Schema.Struct({
  status: Schema.Literal('published'),
  id: artifactIdSchema,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publishedAt: Schema.String,
  url: Schema.String,
  version: Schema.String,
  versionUrl: Schema.String,
  versions: Schema.Int,
  timeline: Schema.NullOr(timelineSchema),
  timelineProblem: Schema.optional(Schema.String),
});

export type PublishedPage = typeof publishedPageSchema.Type;
