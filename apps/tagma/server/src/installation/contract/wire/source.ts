import { Schema } from 'effect';
import { processProvenanceSchema } from '../../../platform/contract/wire/provenance.js';
import { migrationLoadSchema } from '../../../platform/contract/wire/migrationLoad.js';

export const installationCutSchema = Schema.Struct({
  build: Schema.String,
  digest: Schema.String,
});

export type InstallationCut = typeof installationCutSchema.Type;

export const sourceSchema = Schema.Struct({
  cut: Schema.NullOr(processProvenanceSchema),
  installation: Schema.NullOr(installationCutSchema),
});

export type Source = typeof sourceSchema.Type;

export const restartSchema = Schema.Struct({
  leaving: Schema.NullOr(installationCutSchema),
  successor: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal('Installation'), ...installationCutSchema.fields }),
    Schema.Struct({ _tag: Schema.Literal('Checkout') }),
  ]).pipe(Schema.toTaggedUnion('_tag')),
  migrations: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  heavy: Schema.optionalKey(migrationLoadSchema),
});
export type Restart = typeof restartSchema.Type;

export const restartAskSchema = Schema.Struct({});
