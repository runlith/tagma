import { Effect, Schema } from 'effect';
import { AdmissionPhase, Registration } from '@runlith/executions/protocol/registration';
import type { CallDecision } from '@runlith/executions/protocol/call';
import { CommandAdmission } from '@runlith/executions/protocol/command';
import type { Principal } from '@runlith/executions/protocol/custody';
import {
  ExecutionId,
  ExecutionState,
  ExecutionTargetRef,
  HostRequestRef,
  type ExecutionRef,
  type Incarnation,
  type InstallationId,
  type Purpose,
  type Transport,
} from '@runlith/executions/protocol/execution';
import type { NativeProcess } from '@runlith/executions/protocol/launch';
import { FinalFacts } from '@runlith/executions/protocol/stop';
import { withoutNullRuleKeys } from '@runlith/executions/storedRules';
import { CallRecord, CommandRevisionRecord, OperationKind, OperationReceipt, StopIntent } from '../db/persisted';
import type {
  commandRevision as commandRevisionTable,
  execution as executionTable,
  finalFacts as finalFactsTable,
  stopIntent as stopIntentTable,
} from '../db/schema';
import { StoreUnreadable } from './errors';

export type IncarnationRecord = {
  readonly installation: InstallationId;
  readonly incarnation: Incarnation;
  readonly registration: Registration;
  readonly phase: AdmissionPhase;
};

export type ExecutionRecord = {
  readonly state: ExecutionState;
  readonly target: ExecutionTargetRef;
  readonly native: NativeProcess;
  readonly command?: CommandAdmission;
};

export type AdmittedCommand = { readonly record: ExecutionRecord; readonly admittedAtMs: number };

export type RetainedExecution = {
  readonly record: ExecutionRecord;
  readonly final?: FinalFacts;
};

export type RetiredGeneration = {
  readonly incarnation: Incarnation;
  readonly evicting: boolean;
  readonly executions: ReadonlyArray<ExecutionId>;
};

export type GenerationPage = {
  readonly executions: ReadonlyArray<ExecutionId>;
  readonly next: number | undefined;
};

export type RecordRemoval = {
  readonly execution: ExecutionId;
  readonly ledgered: number | undefined;
};

export type ShelfLedger = {
  readonly bytes: number;
  readonly through: number | undefined;
};

export type RetiredLedgerEntry = {
  readonly incarnation: Incarnation;
  readonly evicting: boolean;
  readonly bytes: number | null;
  readonly uncertain: boolean;
};

export type OperationEntry = {
  readonly operation: HostRequestRef;
  readonly kind: OperationKind;
  readonly fingerprint: string;
  readonly receipt: OperationReceipt;
  readonly execution?: ExecutionId;
};

export type CommandRevisionSettlement =
  | { readonly _tag: 'Recorded' }
  | { readonly _tag: 'Taken'; readonly standing: CommandRevisionRecord };

export type UnresolvedStart = {
  readonly operation: HostRequestRef;
  readonly execution: ExecutionRef;
};

export type OperationSettlement =
  | { readonly _tag: 'Recorded'; readonly entry: OperationEntry }
  | { readonly _tag: 'Taken'; readonly entry: OperationEntry };

export type LaunchRequest = {
  readonly operation: HostRequestRef;
  readonly fingerprint: string;
  readonly ref: ExecutionRef;
  readonly transport: Transport;
  readonly purpose: Purpose;
  readonly target: ExecutionTargetRef;
  readonly holder: Principal;
  readonly origin: Principal;
  readonly receipt: OperationReceipt;
} & ({ readonly lifetime: 'call' | 'held' } | { readonly lifetime: 'command'; readonly command: CommandAdmission });

export type CustodyMove = {
  readonly holder: Principal;
};

export type CallDecided =
  | { readonly _tag: 'Recorded'; readonly decision: CallDecision }
  | { readonly _tag: 'Standing'; readonly decision: CallDecision };

export const decodeExecutionId = Schema.decodeUnknownEffect(ExecutionId);
export const decodeRegistration = Schema.decodeUnknownEffect(Registration);
export const decodeAdmissionPhase = Schema.decodeUnknownEffect(AdmissionPhase);
export const decodeCallRecord = Schema.decodeUnknownEffect(CallRecord);
export const decodeOperationRef = Schema.decodeUnknownEffect(HostRequestRef);
export const decodeReceipt = Schema.decodeUnknownEffect(OperationReceipt);
export const decodeOperationKind = Schema.decodeUnknownEffect(OperationKind);
const decodeExecutionState = Schema.decodeUnknownEffect(ExecutionState);
const decodeAdmission = Schema.decodeUnknownEffect(CommandAdmission);
const decodeTarget = Schema.decodeUnknownEffect(ExecutionTargetRef);
const decodeFinalFacts = Schema.decodeUnknownEffect(FinalFacts);
const decodeStopIntent = Schema.decodeUnknownEffect(StopIntent);
const decodeCommandRevision = Schema.decodeUnknownEffect(CommandRevisionRecord);

export const unreadable = (record: string, key: string) => (cause: unknown) => new StoreUnreadable({ record, key, reason: String(cause) });

export const recordFrom = Effect.fnUntraced(function* (row: typeof executionTable.$inferSelect, dependencies: ReadonlyArray<string>) {
  const state = yield* decodeExecutionState({
    ref: { installation: row.installation, execution: row.executionId, incarnation: row.incarnation },
    transport: row.transport,
    lifetime: row.lifetime,
    purpose: row.purpose,
    phase: row.phase,
    nativeExit: row.nativeExit ?? undefined,
    streams: { stdout: row.stdout, stderr: row.stderr, pty: row.pty },
    cleanup: row.cleanup,
    record: row.recordAvailability,
  }).pipe(Effect.mapError(unreadable('execution', row.executionId)));
  const target = yield* decodeTarget({
    environment: row.targetEnvironment,
    namespace: row.targetNamespace,
    cwd: row.targetCwd,
    dependencies,
  }).pipe(Effect.mapError(unreadable('execution-target', row.executionId)));
  const command =
    row.command === null
      ? undefined
      : yield* decodeAdmission(withoutNullRuleKeys(row.command)).pipe(Effect.mapError(unreadable('command', row.executionId)));
  return {
    state,
    target,
    native: { pid: row.pid ?? undefined, terminal: row.terminal ?? undefined },
    command: command,
  } satisfies ExecutionRecord;
});

export const finalFrom = (row: typeof finalFactsTable.$inferSelect) =>
  decodeFinalFacts({
    execution: { installation: row.installation, execution: row.executionId, incarnation: row.incarnation },
    nativeExit: row.nativeExit ?? undefined,
    sources: row.sources,
    cleanup: row.cleanup,
    retention: row.retention,
    confirmed: row.confirmed,
    residual: row.residual,
    unverifiable: row.unverifiable,
    streams: row.streams,
    relation: row.relation,
    coverage: row.coverage,
    abandonedOutput: row.abandonedOutput,
    unacquired: row.unacquired ?? undefined,
  }).pipe(Effect.mapError(unreadable('final-facts', row.executionId)));

export const stopFrom = (row: typeof stopIntentTable.$inferSelect, installation: string) =>
  decodeStopIntent({
    operation: { installation: row.installation, operation: row.operationId },
    execution: { installation, execution: row.executionId, incarnation: row.incarnation },
    cause: row.cause,
    coverage: row.coverage,
    requested: row.requested,
    joined: row.joined,
  }).pipe(Effect.mapError(unreadable('stop-intent', row.executionId)));

export const revisionFrom = (row: typeof commandRevisionTable.$inferSelect | undefined) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodeCommandRevision({
        execution: { installation: row.installation, execution: row.executionId, incarnation: row.incarnation },
        operation: { installation: row.installation, operation: row.operationId },
        fingerprint: row.fingerprint,
        revision: row.revision,
        executionMs: row.executionMs,
        ceilingMs: row.ceilingMs ?? undefined,
        origin: row.origin,
        foregroundMs: row.foregroundMs ?? undefined,
        actor: row.actor,
        cause: row.cause,
        outcome: row.outcome,
        exception:
          row.exceptionActor === null || row.exceptionCause === null ? undefined : { actor: row.exceptionActor, cause: row.exceptionCause },
      }).pipe(Effect.mapError(unreadable('command-revision', row.executionId)));
