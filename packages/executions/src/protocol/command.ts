import { Schema } from 'effect';
import { handle } from '@runlith/utils/printed';
import { CallDecision } from './call';
import { ExecutionRef, ExecutionState, HostRequestRef } from './execution';

export const COMMAND_CLASSES = ['test', 'typecheck', 'git', 'other'] as const;
export const CommandClass = Schema.Literals(COMMAND_CLASSES);
export type CommandClass = typeof CommandClass.Type;

export const CommandExit = Schema.Union([
  Schema.Struct({ _tag: Schema.tag('Code'), code: Schema.Int }),
  Schema.Struct({ _tag: Schema.tag('Signal'), signal: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.tag('Unknown'), detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandExit = typeof CommandExit.Type;

export const CommandProvenance = Schema.Struct({
  scope: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  cohort: Schema.NonEmptyString,
});
export type CommandProvenance = typeof CommandProvenance.Type;

export const LimitProvenance = Schema.Literals(['caller', 'default', 'rule']);
export type LimitProvenance = typeof LimitProvenance.Type;

export const originOf = (limits: { readonly origin?: LimitProvenance }): LimitProvenance => limits.origin ?? 'caller';

export const CommandLimits = Schema.Struct({
  executionMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  executionCeilingMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  origin: Schema.optional(LimitProvenance),
  foregroundMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type CommandLimits = typeof CommandLimits.Type;

export const CommandRuleCopy = Schema.Struct({
  id: Schema.NonEmptyString,
  machine: Schema.optional(Schema.Literal(true)),
  thread: Schema.optional(Schema.String),
  through: Schema.optional(Schema.String),
  limitMs: Schema.Int.check(Schema.isGreaterThan(0)),
  writer: Schema.String,
  at: Schema.String,
  words: Schema.String,
});
export type CommandRuleCopy = typeof CommandRuleCopy.Type;

export const CommandProgram = Schema.Struct({
  words: Schema.NonEmptyArray(Schema.NonEmptyString),
  folder: Schema.optional(Schema.NonEmptyString),
});
export type CommandProgram = typeof CommandProgram.Type;

export const ProgramRuleCopy = Schema.Struct({
  id: Schema.NonEmptyString,
  machine: Schema.optional(Schema.Literal(true)),
  thread: Schema.optional(Schema.NonEmptyString),
  program: CommandProgram,
  limitMs: Schema.Int.check(Schema.isGreaterThan(0)),
  writer: Schema.String,
  at: Schema.String,
  words: Schema.String,
});
export type ProgramRuleCopy = typeof ProgramRuleCopy.Type;

export const CommandPrograms = Schema.Struct({
  root: Schema.optional(Schema.NonEmptyString),
  rules: Schema.NonEmptyArray(ProgramRuleCopy),
});
export type CommandPrograms = typeof CommandPrograms.Type;

export const CommandRequested = Schema.Union([Schema.Int.check(Schema.isGreaterThan(0)), Schema.Literal('none')]);
export type CommandRequested = typeof CommandRequested.Type;

export const CommandAdmission = Schema.Struct({
  origin: CommandProvenance,
  limits: CommandLimits,
  policyIdentity: Schema.NonEmptyString,
  tool: Schema.optional(Schema.NonEmptyString),
  requested: Schema.optional(CommandRequested),
  rules: Schema.optional(Schema.Array(CommandRuleCopy)),
  programs: Schema.optional(CommandPrograms),
});
export type CommandAdmission = typeof CommandAdmission.Type;

export const CommandRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate(handle());
export type CommandRevision = typeof CommandRevision.Type;

export const DeadlineChange = Schema.Union([
  Schema.Struct({ _tag: Schema.tag('Total'), executionMs: Schema.Int.check(Schema.isGreaterThan(0)) }),
  Schema.Struct({ _tag: Schema.tag('Remaining'), remainingMs: Schema.Int.check(Schema.isGreaterThan(0)) }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type DeadlineChange = typeof DeadlineChange.Type;

export const CeilingExemption = Schema.Struct({
  ceilingMs: Schema.Int.check(Schema.isGreaterThan(0)),
  actor: Schema.NonEmptyString,
  cause: Schema.NonEmptyString,
});
export type CeilingExemption = typeof CeilingExemption.Type;

export const CommandRevisionRequest = Schema.Struct({
  operation: HostRequestRef,
  execution: ExecutionRef,
  expected: CommandRevision,
  change: DeadlineChange,
  actor: Schema.NonEmptyString,
  cause: Schema.NonEmptyString,
  exception: Schema.optional(CeilingExemption),
  wait: Schema.optional(Schema.Literal('background')),
});
export type CommandRevisionRequest = typeof CommandRevisionRequest.Type;

export const CommandDeadline = Schema.Struct({
  execution: ExecutionRef,
  revision: CommandRevision,
  executionMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  ceilingMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  origin: LimitProvenance,
  foregroundMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  armed: Schema.optional(Schema.Literal('native-acquired')),
  elapsedMs: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  expiresAt: Schema.optional(Schema.Int),
});
export type CommandDeadline = typeof CommandDeadline.Type;

export const RevisionRefusal = Schema.Literals(['not-armed', 'above-ceiling', 'not-a-command', 'conflict', 'identity']);
export type RevisionRefusal = typeof RevisionRefusal.Type;

export const CommandRevisionAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.tag('Revised'), operation: HostRequestRef, deadline: CommandDeadline }),
  Schema.Struct({ _tag: Schema.tag('Stale'), operation: HostRequestRef, deadline: CommandDeadline }),
  Schema.Struct({
    _tag: Schema.tag('Refused'),
    operation: HostRequestRef,
    reason: RevisionRefusal,
    detail: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.tag('Ended'),
    operation: HostRequestRef,
    state: ExecutionState,
    decision: Schema.optional(CallDecision),
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandRevisionAnswer = typeof CommandRevisionAnswer.Type;

export const CommandSnapshot = Schema.Struct({
  admission: CommandAdmission,
  state: ExecutionState,
  deadline: CommandDeadline,
});
export type CommandSnapshot = typeof CommandSnapshot.Type;
