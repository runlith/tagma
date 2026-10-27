import { Schema } from 'effect';
import { CallDecision, CallDecisionAnswer } from './call';
import { HostGrant } from './capacity';
import { CustodyState } from './custody';
import { ExecutionRef, ExecutionState, ExecutionTargetRef, Incarnation, InstallationId, HostRequestRef, ProcessCost } from './execution';
import { Refusal, UncertainEffect } from './host';
import { InputFrontier } from './input';
import { KeptRecords } from './keep';
import { NativeProcess } from './launch';
import { OutputFile, StreamPositions, TerminalGeometry } from './record';
import { AdmissionPhase, HostCustody } from './registration';
import { FinalFacts, ProcessWatchReading } from './stop';

export const ExecutionSummary = Schema.Struct({
  state: ExecutionState,
  custody: CustodyState,
  streams: Schema.Array(StreamPositions),
  grid: Schema.optional(TerminalGeometry),
  native: NativeProcess,
  input: Schema.optional(InputFrontier),
  decision: Schema.optional(CallDecision),
  cost: Schema.optional(ProcessCost),
  processes: Schema.optional(ProcessWatchReading),
  printed: Schema.optional(Schema.Boolean),
  outputFile: Schema.optional(OutputFile),
});
export type ExecutionSummary = typeof ExecutionSummary.Type;

export const RetainedRecord = Schema.Struct({
  state: ExecutionState,
  native: NativeProcess,
  target: ExecutionTargetRef,
  final: Schema.optional(FinalFacts),
});
export type RetainedRecord = typeof RetainedRecord.Type;

export const ExecutionPage = Schema.Struct({
  executions: Schema.Array(ExecutionSummary),
  after: Schema.optional(ExecutionRef),
});
export type ExecutionPage = typeof ExecutionPage.Type;

export const HostMemory = Schema.Struct({
  granted: HostGrant,
  reserved: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  retained: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  executions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ceiling: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type HostMemory = typeof HostMemory.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const WatchStatus = Schema.Struct({
  rounds: Count,
  delayed: Count,
  skipped: Count,
  failed: Count,
  lastRoundMs: Schema.optional(Count),
  longestRoundMs: Count,
});
export type WatchStatus = typeof WatchStatus.Type;

export const HolderLoss = Schema.Struct({
  reason: Schema.Literals(['gone', 'broken']),
  detail: Schema.String,
});
export type HolderLoss = typeof HolderLoss.Type;

export const HolderState = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Standing') }),
  Schema.Struct({ _tag: Schema.Literal('Lost'), loss: HolderLoss }),
]);
export type HolderState = typeof HolderState.Type;

export const AdoptionRefusal = Schema.Literals([
  'no-record',
  'store-unreadable',
  'no-start',
  'no-admission',
  'capacity',
  'record-unreadable',
  'assembly-failed',
  'departure-lost',
]);
export type AdoptionRefusal = typeof AdoptionRefusal.Type;

export const UnadoptedExecution = Schema.Struct({
  execution: Schema.NonEmptyString,
  ref: Schema.optional(ExecutionRef),
  reason: AdoptionRefusal,
  detail: Schema.String,
});
export type UnadoptedExecution = typeof UnadoptedExecution.Type;

export const RuntimeStatus = Schema.Struct({
  installation: InstallationId,
  incarnation: Incarnation,
  phase: AdmissionPhase,
  holder: HolderState,
  custody: HostCustody,
  executions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  memory: HostMemory,
  watch: Schema.optional(WatchStatus),
  kept: Schema.optional(KeptRecords),
  unadopted: Schema.optional(Schema.Array(UnadoptedExecution)),
});
export type RuntimeStatus = typeof RuntimeStatus.Type;

export const OperationAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Accepted'),
    operation: HostRequestRef,
    execution: Schema.optional(ExecutionRef),
  }),
  Schema.Struct({ _tag: Schema.Literal('Cancelled'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
  Schema.Struct({ _tag: Schema.Literal('Unanswered'), operation: HostRequestRef }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type OperationAnswer = typeof OperationAnswer.Type;

export const QuiescenceTicket = Schema.NonEmptyString.pipe(Schema.brand('QuiescenceTicket'));
export type QuiescenceTicket = typeof QuiescenceTicket.Type;

export const PendingWork = Schema.Struct({
  execution: ExecutionRef,
  reason: Schema.Literals(['call-open', 'input-admitted', 'stop-running', 'start-in-flight']),
});
export type PendingWork = typeof PendingWork.Type;

export const QuiescenceAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Quiesced'), operation: HostRequestRef, ticket: QuiescenceTicket }),
  Schema.Struct({
    _tag: Schema.Literal('RestartDeferred'),
    operation: HostRequestRef,
    ticket: QuiescenceTicket,
    pending: Schema.Array(PendingWork),
  }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type QuiescenceAnswer = typeof QuiescenceAnswer.Type;

export const ResumeAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Resumed'), ticket: QuiescenceTicket, phase: AdmissionPhase }),
  Schema.Struct({ _tag: Schema.Literal('TicketUnknown'), ticket: QuiescenceTicket, phase: AdmissionPhase }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ResumeAnswer = typeof ResumeAnswer.Type;

export const PrepareAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Prepared'), operation: HostRequestRef, checkpoints: Count, unquiet: Count }),
  Schema.Struct({
    _tag: Schema.Literal('Unprepared'),
    operation: HostRequestRef,
    reason: Schema.Literals(['bundle', 'migrations', 'checkpoint', 'holder']),
    detail: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type PrepareAnswer = typeof PrepareAnswer.Type;

export const YieldAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Yielding'), ticket: QuiescenceTicket }),
  Schema.Struct({ _tag: Schema.Literal('TicketUnknown'), ticket: QuiescenceTicket, phase: AdmissionPhase }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), ticket: QuiescenceTicket, refusal: Refusal }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type YieldAnswer = typeof YieldAnswer.Type;

export const CallAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Settled'), result: CallDecisionAnswer }),
  Schema.Struct({ _tag: Schema.Literal('Pending'), operation: HostRequestRef, execution: Schema.optional(ExecutionRef) }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CallAnswer = typeof CallAnswer.Type;
