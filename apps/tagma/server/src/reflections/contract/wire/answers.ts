import { Schema } from 'effect';
import { family } from '@runlith/paging';
import { processProvenanceSchema } from '../../../platform/contract/wire/provenance.js';
import { blockAnswerSchema, listingFacts } from '../../../graph/contract/wire/answers.js';

export const REFLECTIONS = family('reflections', 1, 'text', { text: 189, json: 1406 }, 100, () => ({
  name: 'bcbc65ec',
  tags: ['r'.repeat(10)],
  title: 'x'.repeat(150),
  sightings: 3,
}));

export const reflectionRowSchema = Schema.Struct({
  ...blockAnswerSchema.fields,
  sightings: Schema.Number,
});

export const reflectionListFields = {
  blocks: Schema.Array(reflectionRowSchema),
  ...listingFacts,
};

export type ReflectionList = Schema.Struct.Type<typeof reflectionListFields> & { readonly status: 'ok' };

export const reflectionFiledFields = {
  block: blockAnswerSchema,
  body: Schema.optional(Schema.Array(Schema.String)),
  sightings: Schema.Number,
  already: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String, shared: Schema.Number })),
  receivedBy: Schema.NullOr(processProvenanceSchema),
  unplaced: Schema.optional(Schema.String).annotate({
    description: 'Why the entry stands outside the owner of the code declaring the operation it is about, and what to do.',
  }),
};

export type ReflectionFiled = Schema.Struct.Type<typeof reflectionFiledFields> & { readonly status: 'ok' };
