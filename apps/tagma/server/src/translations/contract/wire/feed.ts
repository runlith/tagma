import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { translationFrameSchema } from './projection.js';

export const TRANSLATION_FEED = feed('translations.changes', {
  input: Schema.Struct({ projectId: Schema.Int.check(Schema.isGreaterThan(0)) }),
  event: translationFrameSchema,
  refusals: [],
  callers: 'operator',
  admission: 'project',
  graph: 'none',
});
