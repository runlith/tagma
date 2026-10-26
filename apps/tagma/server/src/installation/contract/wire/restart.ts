import { Data, Schema } from 'effect';
import { sourceSchema } from './source.js';
import { phaseStampSchema } from '../../../platform/contract/wire/phases.js';
import { migrationLoadSchema } from '../../../platform/contract/wire/migrationLoad.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const restartDoorSchema = Schema.Literals(['local', 'remote']);
export type RestartDoor = typeof restartDoorSchema.Type;

export const restartPointSchema = Schema.Struct({
  name: Schema.String,
  at: Schema.Finite,
  pid: Schema.Int,
  door: Schema.NullOr(restartDoorSchema),
  migrations: Schema.NullOr(Schema.Int),
});
export type RestartPoint = typeof restartPointSchema.Type;

const processSchema = Schema.Struct({ pid: Schema.Int, source: sourceSchema });

export const restartFrameSchema = Schema.Struct({
  door: restartDoorSchema,
  projectId: Schema.Int,
  threadId: Schema.String,
  at: Schema.Finite,
  intervalMs: Schema.NullOr(Schema.Finite),
});
export type RestartFrame = typeof restartFrameSchema.Type;

export const restartWindowSchema = Schema.Struct({
  restartId: Schema.String,
  clientId: Schema.String,
  door: restartDoorSchema,
  projectId: Schema.Int,
  threadId: Schema.String.annotate(placeRole('value')),
  durationMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type RestartWindow = typeof restartWindowSchema.Type;

export const startupAttemptSchema = Schema.Struct({
  pid: Schema.Int,
  startedAt: Schema.Finite,
  readyAt: Schema.NullOr(Schema.Finite),
  expectedMs: Schema.NullOr(Schema.Finite),
  step: Schema.NullOr(Schema.Struct({ name: Schema.String, index: Schema.Int, total: Schema.Int })),
});

export const startupSchema = Schema.Struct({
  ...startupAttemptSchema.fields,
  heavy: Schema.optional(migrationLoadSchema),
  status: Schema.Literals(['starting', 'ready', 'failed']),
  phase: Schema.String,
  failure: Schema.NullOr(Schema.Struct({ phase: Schema.String, detail: Schema.String, at: Schema.Finite })),
});
export type Startup = typeof startupSchema.Type;

export const restartStageSchema = Schema.Literals(['accepted', 'prepared', 'transferred', 'serving', 'restored', 'failed']);
export type RestartStage = typeof restartStageSchema.Type;

export const handoverSchema = Schema.Struct({
  id: Schema.String,
  stage: restartStageSchema,
  underway: Schema.Boolean,
  failure: Schema.NullOr(Schema.String),
  stays: Schema.Boolean,
});
export type Handover = typeof handoverSchema.Type;

export const restartRecordSchema = Schema.Struct({
  id: Schema.String,
  heavy: Schema.optional(migrationLoadSchema),
  startup: Schema.NullOr(startupAttemptSchema),
  predecessor: Schema.NullOr(processSchema),
  successor: Schema.NullOr(processSchema),
  phases: Schema.Array(phaseStampSchema),
  points: Schema.Array(restartPointSchema),
  frames: Schema.Array(restartFrameSchema),
  windows: Schema.Array(Schema.Struct({ ...restartWindowSchema.fields, receivedAt: Schema.Finite, exceeded: Schema.Boolean })),
  failure: Schema.NullOr(Schema.Struct({ at: Schema.Finite, pid: Schema.Int, detail: Schema.String })),
  hostEnded: Schema.optionalKey(Schema.Struct({ at: Schema.Finite, executions: Schema.NullOr(Schema.Int), detail: Schema.String })),
  unreleased: Schema.optionalKey(Schema.Struct({ at: Schema.Finite, detail: Schema.String })),
});
export type RestartRecord = typeof restartRecordSchema.Type;

export const restartIssueSchema = Schema.Struct({
  kind: Schema.Literals(['unreadable', 'unwritable']),
  path: Schema.String,
  detail: Schema.String,
});
export type RestartIssue = typeof restartIssueSchema.Type;

export const restartStateSchema = Schema.Struct({
  record: Schema.NullOr(restartRecordSchema),
  issue: Schema.NullOr(restartIssueSchema),
  stage: Schema.NullOr(restartStageSchema),
  startup: Schema.NullOr(startupSchema),
});
export const startupStateSchema = Schema.Struct({
  startup: Schema.NullOr(startupSchema),
  issue: Schema.NullOr(restartIssueSchema),
  restart: Schema.optional(Schema.NullOr(handoverSchema)),
});
export type StartupState = typeof startupStateSchema.Type;
export type RestartState = typeof restartStateSchema.Type;

export class RestartRecordUnreadable extends Data.TaggedError('RestartRecordUnreadable')<{
  readonly path: string;
  readonly detail: string;
}> {}

export class RestartRecordUnwritable extends Data.TaggedError('RestartRecordUnwritable')<{
  readonly path: string;
  readonly detail: string;
}> {}

export class RestartWindowRefused extends Data.TaggedError('RestartWindowRefused')<{ readonly detail: string }> {}

export const RESTART_ID = 'TAGMA_RESTART_ID';
export const RESTART_RECORD = 'restart.json';
export const WINDOW_CEILING_MS = 10_000;
