import { Schema } from 'effect';

export const downgradeStepSchema = Schema.Struct({
  step: Schema.Literals(['downgrade-preflight', 'console-key-rollback']),
  state: Schema.Literals(['passed', 'written', 'unbound', 'skipped']),
  detail: Schema.String,
});

export type DowngradeStep = typeof downgradeStepSchema.Type;

export const snapshotLossSchema = Schema.Struct({
  owner: Schema.String,
  table: Schema.String,
  key: Schema.String,
  reason: Schema.String,
});

export const downgradeAskSchema = Schema.Struct({
  snapshot: Schema.optional(Schema.String),
});

export const downgradeReadySchema = Schema.Struct({
  steps: Schema.Array(downgradeStepSchema),
  losses: Schema.Array(snapshotLossSchema),
});

export type DowngradeReady = typeof downgradeReadySchema.Type;
