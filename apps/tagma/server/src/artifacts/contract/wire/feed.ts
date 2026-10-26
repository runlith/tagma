import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { artifactIdSchema, pageStateSchema, threadPagesSchema } from './artifacts.js';

export const THREAD_PAGES_SHOWN = 50;

export const TEAM_CEILING = 256;

export const THREAD_PAGES_FEED = feed('artifacts.thread', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    threads: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(TEAM_CEILING)),
  }),
  event: threadPagesSchema,
  refusals: [],
  callers: 'operator',
  admission: 'project',
});

export const PAGE_FEED = feed('artifacts.page', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    id: artifactIdSchema,
  }),
  event: pageStateSchema,
  refusals: [],
  callers: 'operator',
  admission: 'project',
  graph: 'none',
});
