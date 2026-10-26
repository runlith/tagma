import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PACES, Pace } from '@runlith/executions/protocol/pace';

export const AWAKE_MODES = ['while-working', 'always', 'off'] as const;
export type AwakeMode = (typeof AWAKE_MODES)[number];
export const DEFAULT_AWAKE_MODE: AwakeMode = 'while-working';

export const sleepAssertionStateSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('holding') }),
  Schema.Struct({ _tag: Schema.Literal('released') }),
  Schema.Struct({ _tag: Schema.Literal('unavailable'), reason: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('failed'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type SleepAssertionState = typeof sleepAssertionStateSchema.Type;

export const awakeStateSchema = Schema.Struct({
  mode: Schema.Literals(AWAKE_MODES),
  state: sleepAssertionStateSchema,
  limit: Schema.NullOr(Schema.String),
});
export type AwakeState = typeof awakeStateSchema.Type;

export const AGENT_PACES = PACES;
export type PaceLevel = Pace;
export const DEFAULT_AGENT_PACE: PaceLevel = 'full';

export const paceHandoverSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('handing') }),
  Schema.Struct({
    _tag: Schema.Literal('applied'),
    pace: Pace,
    reached: Schema.Int,
    kept: Schema.Int,
    failed: Schema.Int,
  }),
  Schema.Struct({ _tag: Schema.Literal('unavailable'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type PaceHandover = typeof paceHandoverSchema.Type;

export const paceStateSchema = Schema.Struct({
  pace: Pace,
  state: paceHandoverSchema,
});
export type PaceState = typeof paceStateSchema.Type;

export const AWAKE_FEED = feed('awake.subscribe', {
  input: Schema.Struct({}),
  event: awakeStateSchema,
  refusals: [],
  callers: 'operator',
});

export const PACE_FEED = feed('pace.subscribe', {
  input: Schema.Struct({}),
  event: paceStateSchema,
  refusals: [],
  callers: 'operator',
});
