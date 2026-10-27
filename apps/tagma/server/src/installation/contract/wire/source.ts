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

export const restartHostSchema = Schema.Literals(['hand-over', 'replace']).annotate({
  description:
    'hand-over (the default) gives the standing execution host to the successor, and a host that will not take the successor refuses the restart; replace ends everything the standing host runs and raises a host from the successor’s own bundle.',
});
export type RestartHost = typeof restartHostSchema.Type;

export const restartAskSchema = Schema.Struct({ host: Schema.optional(restartHostSchema) });
