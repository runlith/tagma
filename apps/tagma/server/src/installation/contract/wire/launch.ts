import { Schema } from 'effect';

export const SUPERVISED = 'TAGMA_SUPERVISED';
export const REPLACES = 'TAGMA_REPLACES';
export const HANDOFF = 'TAGMA_HANDOFF';
export const RELEASES = 'TAGMA_LAUNCH_RELEASES';
export const HOST_STATE = 'TAGMA_HOST_STATE';
export const HOST_REPLACE = 'TAGMA_HOST_REPLACE';

export const STANDING_BY = 'standing-by';

export const handoffSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Released'), pid: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal('ReleaseFailed'), pid: Schema.Int, detail: Schema.String }),
]);
export type Handoff = typeof handoffSchema.Type;

export const handoffOf = (pid: number, failure: string | null): Handoff =>
  failure === null ? { _tag: 'Released', pid } : { _tag: 'ReleaseFailed', pid, detail: failure };

export const takeoverSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Taken'), pid: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal('Serving'), pid: Schema.Int }),
]);
export type Takeover = typeof takeoverSchema.Type;

export const launchRequestSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Start'),
    id: Schema.String,
    command: Schema.NonEmptyArray(Schema.String),
    env: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({ _tag: Schema.Literal('Cancel'), id: Schema.String }),
]);
export type LaunchRequest = typeof launchRequestSchema.Type;

export const launchAnswerSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Started'), id: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Failed'), id: Schema.String, detail: Schema.String }),
]);
export type LaunchAnswer = typeof launchAnswerSchema.Type;
