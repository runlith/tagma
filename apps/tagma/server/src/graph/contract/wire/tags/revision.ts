import { Schema } from 'effect';

export const VOCABULARY_FORMAT = 2;

export const vocabularyRevisionSchema = Schema.Struct({
  format: Schema.Int.check(Schema.isGreaterThan(0)),
  revision: Schema.String,
});
export type VocabularyRevision = typeof vocabularyRevisionSchema.Type;
