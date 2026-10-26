import { Schema } from 'effect';
import { CallBudget, CallDeadline } from './call';
import { CommandAdmission } from './command';
import { Principal } from './custody';
import {
  EffectiveEnvironment,
  ExecutionRef,
  ExecutionState,
  ExecutionTargetRef,
  Lifetime,
  HostRequestRef,
  Purpose,
  Transport,
} from './execution';
import { Refusal, UncertainEffect } from './host';
import { TerminalGeometry } from './record';

export const StdinPolicy = Schema.Literals(['pipe', 'inherit', 'ignore']);
export type StdinPolicy = typeof StdinPolicy.Type;

export const StreamingOutput = Schema.Array(Schema.Literals(['stdout', 'stderr']));
export type StreamingOutput = typeof StreamingOutput.Type;

export const LaunchCommand = Schema.Struct({
  program: Schema.NonEmptyString,
  args: Schema.Array(Schema.String),
  environment: EffectiveEnvironment,
  cwd: Schema.optional(Schema.NonEmptyString),
});
export type LaunchCommand = typeof LaunchCommand.Type;

export const LaunchTransport = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('pipes'),
    stdin: StdinPolicy,
    streaming: Schema.optional(StreamingOutput),
  }),
  Schema.Struct({ _tag: Schema.Literal('pty'), geometry: TerminalGeometry }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type LaunchTransport = typeof LaunchTransport.Type;

const launched = {
  command: LaunchCommand,
  transport: LaunchTransport,
  purpose: Purpose,
  target: ExecutionTargetRef,
  holder: Principal,
  origin: Principal,
  paced: Schema.optional(Schema.Literal(true)),
} as const;

export const LaunchRequest = Schema.Union([
  Schema.Struct({ ...launched, lifetime: Schema.Literal('call'), budget: Schema.optional(CallBudget) }),
  Schema.Struct({ ...launched, lifetime: Schema.Literal('held'), budget: Schema.optional(CallBudget) }),
  Schema.Struct({ ...launched, lifetime: Schema.Literal('command'), admission: CommandAdmission }),
]).pipe(Schema.toTaggedUnion('lifetime'));
export type LaunchRequest = typeof LaunchRequest.Type;

export const NativeProcess = Schema.Struct({
  pid: Schema.optional(Schema.Int),
  terminal: Schema.optional(Schema.NonEmptyString),
});
export type NativeProcess = typeof NativeProcess.Type;

export const StartAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Started'),
    operation: HostRequestRef,
    execution: ExecutionRef,
    state: ExecutionState,
    native: NativeProcess,
    deadline: Schema.optional(CallDeadline),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Accepted'),
    operation: HostRequestRef,
    execution: ExecutionRef,
    state: ExecutionState,
  }),
  Schema.Struct({ _tag: Schema.Literal('Cancelled'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type StartAnswer = typeof StartAnswer.Type;

export const CancelAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Prevented'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Attached'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Joined'), operation: HostRequestRef, execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CancelAnswer = typeof CancelAnswer.Type;

export const LaunchSummary = Schema.Struct({
  transport: Transport,
  lifetime: Lifetime,
  purpose: Purpose,
  program: Schema.NonEmptyString,
  argumentCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  environmentNames: Schema.Array(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
});
export type LaunchSummary = typeof LaunchSummary.Type;
