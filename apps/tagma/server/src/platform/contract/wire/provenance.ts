import { Schema } from 'effect';

export const processProvenanceSchema = Schema.Struct({
  startedAt: Schema.String,
  revision: Schema.NullOr(Schema.Struct({ head: Schema.String, dirty: Schema.Boolean })),
});

export type ProcessProvenance = typeof processProvenanceSchema.Type;

export function provenanceLine(provenance: ProcessProvenance): string {
  if (provenance.revision === null) return `up since ${provenance.startedAt}, from a checkout that named no revision`;
  const from = provenance.revision.dirty ? `${provenance.revision.head} with uncommitted work` : provenance.revision.head;
  return `up since ${provenance.startedAt}, from ${from}`;
}
