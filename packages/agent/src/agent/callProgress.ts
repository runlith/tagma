import { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { CallStopping } from '@runlith/executions/protocol/call';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export const CallExecution = Schema.Struct({
  execution: ExecutionRef,
  operation: HostRequestRef,
  kind: Schema.Literals(['command', 'support']),
  label: Schema.String,
});
export type CallExecution = typeof CallExecution.Type;
export type CallAuthority = 'operator' | 'agent';
export const CallControlResult = Schema.Struct({
  status: Schema.Literals(['changed', 'ended', 'missing', 'unavailable']),
  detail: Schema.NullOr(Schema.String),
});
export type CallControlResult = typeof CallControlResult.Type;
export type CallExecutionControl = {
  readonly revise: (remainingMs: number, authority: CallAuthority) => Effect.Effect<CallControlResult>;
  readonly background?: () => Effect.Effect<CallMove>;
  readonly handed?: (moved: boolean) => Effect.Effect<void>;
};
//! `carried`: the execution now owes the call's ending itself, so the call records no debt of its own.
export type CallMove =
  | { readonly status: 'carried' }
  | { readonly status: 'stays' }
  | { readonly status: 'unavailable'; readonly detail: string | null };
export type CallProgress = CallStopping & {
  readonly link: (execution: CallExecution, control?: CallExecutionControl) => () => void;
  readonly stage: (detail: string) => void;
  readonly watch: () => void;
  readonly handOff: () => Effect.Effect<CallControlResult>;
};

export const CallAddress = Schema.Struct({ runId: Schema.String, toolCallId: Schema.String });
export type CallAddress = typeof CallAddress.Type;

export const LONGEST_ACT_MS = 10 * 60_000;

//! Every invocation stands under this envelope from the moment it is admitted to run: twice the ten minutes this product permits a thread's process as one act, because an envelope must exceed what it encloses, and the second half is the room a call that has gone silent gets to be taken down and answered.
export const CALL_ENVELOPE_MS = 2 * LONGEST_ACT_MS;

export const AGENT_IDLE_MS = 300_000;

export const STALL_FLOOR_MS = 2 * AGENT_IDLE_MS;

export const stallAfterMs = (callEnvelopeMs: number | null): number | null =>
  callEnvelopeMs === null ? null : Math.max(STALL_FLOOR_MS, callEnvelopeMs);

export const CallRecord = Schema.Struct({
  ...CallAddress.fields,
  threadId: Schema.NullOr(Schema.String),
  name: Schema.String,
  input: Schema.Unknown,
  phase: Schema.Literals(['preparing', 'waiting', 'running', 'stopping', 'completed', 'failed', 'stopped', 'unavailable', 'interrupted']),
  mode: Schema.Literals(['foreground', 'background']),
  detachable: Schema.Boolean,
  startedAt: Schema.Number,
  admittedAt: Schema.NullOr(Schema.Number),
  endedAt: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.Number),
  expiresBy: Schema.NullOr(Schema.Literals(['limit', 'envelope'])),
  limitCeilingMs: Schema.NullOr(Schema.Number),
  detail: Schema.NullOr(Schema.String),
  executions: Schema.Array(CallExecution),
});
export type CallRecord = typeof CallRecord.Type;
export const callEnded = (call: CallRecord): boolean => call.endedAt !== null;

export const CallAfter = Schema.Struct({ toolCallId: Schema.String, toolName: Schema.String, on: Schema.NullOr(Schema.String) });
export type CallAfter = typeof CallAfter.Type;

export type CallAdmission =
  | { readonly state: 'queued'; readonly reason: string; readonly after?: readonly CallAfter[] }
  | {
      readonly state: 'started';
      readonly at: number;
      readonly mutates?: boolean;
      readonly after?: readonly CallAfter[];
      readonly waitedMs?: number;
    };
export const CallEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('snapshot'), calls: Schema.Array(CallRecord) }),
  Schema.Struct({ type: Schema.Literal('updated'), call: CallRecord }),
]);
export type CallEvent = typeof CallEvent.Type;
export const CallControl = Schema.Union([
  Schema.Struct({ action: Schema.Literal('stop') }),
  Schema.Struct({ action: Schema.Literal('background') }),
  Schema.Struct({ action: Schema.Literal('limit'), milliseconds: Schema.Int.check(Schema.isGreaterThan(0)) }),
]);
export type CallControl = typeof CallControl.Type;
