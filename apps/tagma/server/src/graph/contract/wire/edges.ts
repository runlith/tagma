import { Schema } from 'effect';

export const CORE_EDGES: readonly string[] = ['supersedes', 'amends', 'discovered-from'];

export const edgeNameSchema = Schema.NonEmptyString.annotate({
  description: 'A non-empty edge name: a declared relation, or core provenance (discovered-from, supersedes, amends).',
});
export type EdgeKind = typeof edgeNameSchema.Type;
