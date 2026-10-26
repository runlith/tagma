import * as Schema from 'effect/Schema';
import { ExecutionRef, ExecutionState, Transport } from '@runlith/executions/protocol/execution';
import { Principal, BindingId, CustodyRevision } from '@runlith/executions/protocol/custody';
import { ListenerReport } from '@runlith/executions/protocol/evidence';
import { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { EnvironmentUseId } from '../../../workspace/contract/wire/environments.js';
import { RootId, UseId } from '../../../workspace/contract/wire/ids.js';
import { TargetKey } from './targets.js';
import { TerminalOperationKey } from './requestKeys.js';

export const TerminalActor = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Thread'), threadId: ThreadId, projectId: Schema.Int }),
  Schema.Struct({
    _tag: Schema.Literal('Foreign'),
    harness: Schema.NonEmptyString,
    key: Schema.NonEmptyString,
    projectId: Schema.Int,
  }),
  Schema.Struct({ _tag: Schema.Literal('Operator') }),
]).pipe(Schema.toTaggedUnion('_tag'));

export type TerminalActor = typeof TerminalActor.Type;

export const TerminalLifetime = Schema.Literals(['call', 'held']);

export type TerminalLifetime = typeof TerminalLifetime.Type;

export const TerminalIntentPhase = Schema.Literals(['reserved', 'dispatched', 'uncertain']);

export type TerminalIntentPhase = typeof TerminalIntentPhase.Type;

export const TerminalHoldings = Schema.Struct({
  rootUse: Schema.optional(UseId),
  environmentUse: Schema.optional(EnvironmentUseId),
});

export type TerminalHoldings = typeof TerminalHoldings.Type;

export const TerminalIntent = Schema.Struct({
  key: TerminalOperationKey,
  phase: TerminalIntentPhase,
  holdings: TerminalHoldings,
  outgoing: Schema.optional(ThreadId),
  incoming: Schema.optional(ThreadId),
  rootId: Schema.optional(RootId),
  launchedFor: Schema.optional(ThreadId),
  shellKey: Schema.optional(Schema.NonEmptyString),
  openedAt: Schema.Number,
});

export type TerminalIntent = typeof TerminalIntent.Type;

export const TerminalQuarantine = Schema.Literals(['unknown-thread', 'unknown-principal', 'untrusted-provenance']);

export type TerminalQuarantine = typeof TerminalQuarantine.Type;

export const TerminalRecord = Schema.Struct({
  projectId: Schema.Int,
  execution: ExecutionRef,
  transport: Transport,
  lifetime: TerminalLifetime,
  targetKey: TargetKey,
  holder: Principal,
  origin: Principal,
  revision: CustodyRevision,
  holdings: TerminalHoldings,
  heldBy: Schema.optional(ThreadId),
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  program: Schema.optional(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
  quarantine: Schema.optional(TerminalQuarantine),
  rootId: Schema.optional(RootId),
  launchedFor: Schema.optional(ThreadId),
  shellKey: Schema.optional(Schema.NonEmptyString),
  acceptedAt: Schema.Number,
});

export type TerminalRecord = typeof TerminalRecord.Type;

export const TerminalView = Schema.Struct({
  projectId: Schema.Int,
  execution: ExecutionRef,
  transport: Transport,
  lifetime: TerminalLifetime,
  holder: Principal,
  heldBy: Schema.optional(ThreadId),
  revision: CustodyRevision,
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  program: Schema.optional(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
  quarantine: Schema.optional(TerminalQuarantine),
  rootId: Schema.optional(RootId),
  launchedFor: Schema.optional(ThreadId),
  adoptedBy: Schema.optional(ThreadId),
  acceptedAt: Schema.Number,
});

export type TerminalView = typeof TerminalView.Type;

export const terminalView = (record: TerminalRecord): TerminalView => ({
  projectId: record.projectId,
  execution: record.execution,
  transport: record.transport,
  lifetime: record.lifetime,
  holder: record.holder,
  heldBy: record.heldBy,
  revision: record.revision,
  label: record.label,
  commandLine: record.commandLine,
  program: record.program,
  cwd: record.cwd,
  quarantine: record.quarantine,
  rootId: record.rootId,
  launchedFor: record.launchedFor,
  acceptedAt: record.acceptedAt,
});

export const TerminalListQuery = Schema.Struct({
  standing: Schema.optional(Schema.Boolean),
  holder: Schema.optional(Principal),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  execution: Schema.optional(Schema.NonEmptyString),
  after: Schema.optional(
    Schema.Struct({
      acceptedAt: Schema.Number,
      execution: Schema.NonEmptyString,
    }),
  ),
});

export type TerminalListQuery = typeof TerminalListQuery.Type;

export const TerminalRow = Schema.Struct({
  record: TerminalView,
  state: Schema.optional(ExecutionState),
  listeners: Schema.optional(ListenerReport),
  printed: Schema.optional(Schema.Boolean),
});

export type TerminalRow = typeof TerminalRow.Type;

export const TerminalWaitAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Decided'), summary: ExecutionSummary }),
  Schema.Struct({ _tag: Schema.Literal('Undecided'), summary: Schema.optional(ExecutionSummary) }),
  Schema.Struct({ _tag: Schema.Literal('Unwatchable') }),
]).pipe(Schema.toTaggedUnion('_tag'));

export type TerminalWaitAnswer = typeof TerminalWaitAnswer.Type;

export const InteractiveGrant = Schema.Struct({
  projectId: Schema.Int,
  execution: ExecutionRef,
  actor: Principal,
  targetKey: TargetKey,
  binding: BindingId,
  runId: Schema.optional(Schema.NonEmptyString),
  permissionRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type InteractiveGrant = typeof InteractiveGrant.Type;

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

const quoted = (word: string): string => (SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

export const commandLine = (program: string, args: readonly string[]): string => [program, ...args].map(quoted).join(' ');
