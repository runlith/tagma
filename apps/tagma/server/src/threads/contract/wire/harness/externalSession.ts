import { Schema } from 'effect';
import { harnessExecutionSchema, harnessObservationSchema } from './observation.js';
import { harnessHeldSchema } from './answer.js';
import { harnessSessionSchema } from './session.js';
import { harnessAskedModelSchema } from './askedModel.js';
import { harnessNameSchema, harnessTransportSchema } from './names.js';
import { transportCapabilitiesSchema } from '@runlith/agent/thread/record';

export const harnessPresentationSchema = Schema.Struct({
  label: Schema.String,
  iconProvider: Schema.NullOr(Schema.String),
  mark: Schema.NullOr(Schema.String),
  install: Schema.NullOr(Schema.String),
  modelProvider: Schema.NullOr(Schema.String),
  terminal: Schema.Boolean,
  acp: Schema.Boolean,
  hosted: Schema.Boolean,
  sharedSessions: Schema.Boolean,
});
export type HarnessPresentation = typeof harnessPresentationSchema.Type;

export const harnessInstallSchema = Schema.Struct({
  harness: harnessNameSchema,
  presentation: harnessPresentationSchema,
  binary: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  unreadable: Schema.NullOr(Schema.String),
  serves: Schema.NullOr(Schema.String),
  searching: Schema.Boolean,
  missing: Schema.NullOr(Schema.String),
});
export type HarnessInstall = typeof harnessInstallSchema.Type;

export const harnessTypedShapeSchema = Schema.Struct({
  digest: Schema.String,
  breaks: Schema.Int,
});
export type HarnessTypedShape = typeof harnessTypedShapeSchema.Type;

export const harnessTurnSchema = Schema.Struct({
  run: Schema.String,
  turn: Schema.NullOr(Schema.String),
  openedAt: Schema.String,
  offset: Schema.NullOr(Schema.Int),
  address: Schema.optional(Schema.NullOr(Schema.String)),
  spoke: Schema.optional(Schema.Int),
  words: Schema.optional(Schema.String),
  movedAt: Schema.optional(Schema.String),
  typed: Schema.optional(Schema.Array(harnessTypedShapeSchema)),
});
export type HarnessTurn = typeof harnessTurnSchema.Type;

export const harnessUnreadSchema = Schema.Struct({
  run: Schema.String,
  items: Schema.Array(Schema.String),
  at: Schema.String,
  offset: Schema.optional(Schema.Number),
  send: Schema.optional(Schema.Literals(['intended', 'sending'])),
  digest: Schema.optional(Schema.String),
  steered: Schema.optional(Schema.Literal(true)),
});
export type HarnessUnread = typeof harnessUnreadSchema.Type;

export const harnessInterruptSchema = Schema.Struct({
  turn: harnessTurnSchema,
  at: Schema.String,
  heard: Schema.optional(Schema.String),
});

export const harnessArmedSchema = Schema.Struct({
  at: Schema.String,
  operation: Schema.String,
  confirmedAt: Schema.optional(Schema.String),
});
export type HarnessArmed = typeof harnessArmedSchema.Type;
export type HarnessInterrupt = typeof harnessInterruptSchema.Type;

export const harnessInterruptingSchema = Schema.Struct({
  run: Schema.String,
  operation: Schema.String,
  drafted: Schema.Boolean,
});
export type HarnessInterrupting = typeof harnessInterruptingSchema.Type;

export const externalSessionSchema = Schema.Struct({
  name: harnessNameSchema,
  home: Schema.optional(Schema.String),
  plain: Schema.optional(Schema.Boolean),
  permissionMode: Schema.optional(Schema.String),
  session: Schema.optional(harnessSessionSchema),
  retiring: Schema.optional(Schema.Boolean),
  sessionKey: Schema.NullOr(Schema.String),
  execution: Schema.NullOr(harnessExecutionSchema),
  observation: harnessObservationSchema,
  held: Schema.optional(harnessHeldSchema),
  seen: Schema.optional(Schema.Array(Schema.String)),
  turn: Schema.optional(harnessTurnSchema),
  lastTurn: Schema.optional(Schema.String),
  unread: Schema.optional(Schema.Array(harnessUnreadSchema)),
  interrupted: Schema.optional(harnessInterruptSchema),
  interrupting: Schema.optional(harnessInterruptingSchema),
  armed: Schema.optional(harnessArmedSchema),
});
export type ExternalSession = typeof externalSessionSchema.Type;

export const launchedExecution = (facet: ExternalSession): ExternalSession['execution'] =>
  facet.session?.origin === 'adopted' ? null : facet.execution;

export const harnessRowProcessSchema = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(['starting', 'running', 'stopping', 'uncertain', 'ended']),
  startedAt: Schema.String,
  origin: Schema.optional(Schema.Literals(['launched', 'adopted'])),
  failure: Schema.optional(Schema.String),
});

export const harnessRowSchema = Schema.Struct({
  name: harnessNameSchema,
  transport: harnessTransportSchema,
  agent: Schema.NullOr(Schema.String),
  provider: Schema.String,
  capabilities: transportCapabilitiesSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  asked: Schema.NullOr(harnessAskedModelSchema),
  execution: Schema.NullOr(Schema.Struct({ execution: Schema.String, incarnation: Schema.Int })),
  process: Schema.NullOr(harnessRowProcessSchema),
  observation: harnessObservationSchema,
});
export type HarnessRowDetail = typeof harnessRowSchema.Type;

const decodeFacet = Schema.decodeUnknownResult(Schema.NullOr(externalSessionSchema));

export function parseExternalSession(value: unknown): ExternalSession | null {
  const parsed = decodeFacet(value ?? null);
  if (parsed._tag !== 'Success') {
    throw new Error(`Persisted harness facet cannot be read — ${parsed.failure.message}`);
  }
  return parsed.success;
}
