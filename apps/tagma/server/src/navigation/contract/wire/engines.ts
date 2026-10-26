import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ENGINE_PHASES = ['idle', 'waiting', 'starting', 'loading', 'serving', 'ending', 'resting'] as const;
export type EnginePhase = (typeof ENGINE_PHASES)[number];

export const EngineRow = Schema.Struct({
  root: Schema.String,
  rootId: Schema.String,
  engine: Schema.String,
  base: Schema.Boolean,
  phase: Schema.Literals(ENGINE_PHASES),
  generation: Count,
  revision: Schema.NullOr(Schema.String),
  lag: Schema.NullOr(Count),
  warming: Schema.Boolean,
  memory: Schema.NullOr(Count),
  leases: Count,
  questions: Count,
  lastUse: Schema.String,
  failure: Schema.NullOr(Schema.String),
  retryAt: Schema.NullOr(Schema.String),
});
export type EngineRow = typeof EngineRow.Type;

export const EngineBudget = Schema.Struct({
  total: Count,
  engine: Count,
  engines: Count,
  cpus: Count,
  questions: Count,
  idle: Schema.String,
});
export type EngineBudget = typeof EngineBudget.Type;

export const EngineReading = Schema.Struct({
  budget: EngineBudget,
  engines: Schema.Array(EngineRow),
  total: Count,
});
export type EngineReading = typeof EngineReading.Type;
