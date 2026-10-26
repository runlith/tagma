import type { CustodyNotice } from '../contract/service/custody.js';
import { Effect, Schema } from 'effect';
import {
  ExecutionId,
  HostRequestKey,
  type ExecutionRef,
  type InstallationId,
  type HostRequestRef,
} from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import { withoutNullRuleKeys } from '@runlith/executions/storedRules';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { TargetKey } from '../contract/wire/targets.js';
import { TerminalRecord } from '../contract/wire/terminals.js';
import { actorOfPrincipal } from '../terminals/principals.js';
import { TerminalUnavailable, type TerminalRefused } from '../contract/wire/refusals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { CommandDelivery, CommandRecord, CommandWait, type CommandWaitMode } from '../contract/wire/commands.js';
import type { command, commandDelivery, commandWait, custodyNotice, terminal, terminalRequestKey } from './terminal.js';

export type ExecutionStoreFailure = TerminalRefused | TerminalUnavailable;

export type RequestKeyRow = typeof terminalRequestKey.$inferSelect;

export type CommandState = {
  readonly record: CommandRecord;
  readonly wait: CommandWait | null;
};

const decodeRecord = Schema.decodeUnknownEffect(TerminalRecord);
const decodeCommandRecord = Schema.decodeUnknownEffect(CommandRecord);
const decodeCommandWait = Schema.decodeUnknownEffect(CommandWait);
const decodeCommandDelivery = Schema.decodeUnknownEffect(CommandDelivery);

export const queried = <A>(unit: Unit<'machine'>, query: Effect.Effect<A, StoreFailure>): Effect.Effect<A, TerminalUnavailable> =>
  Effect.mapError(
    unit.run(query),
    (cause) => new TerminalUnavailable({ owner: 'store', message: `The machine store could not answer: ${cause.message}` }),
  );

export const decoded = <A>(decoder: (input: unknown) => Effect.Effect<A, unknown>, input: unknown): Effect.Effect<A, TerminalUnavailable> =>
  Effect.mapError(
    decoder(input),
    (cause) =>
      new TerminalUnavailable({
        owner: 'store',
        message: `A stored terminal record no longer decodes: ${String(cause)}`,
      }),
  );

export const storedTime = (text: string | null): { readonly time?: unknown } =>
  text === null ? {} : { time: withoutNullRuleKeys(JSON.parse(text)) };

export const armOfStored = (
  stored: string,
  projectId: number,
): Effect.Effect<{ readonly _tag: 'Thread'; readonly thread: ThreadId } | { readonly _tag: 'Operator' }, TerminalUnavailable> => {
  const actor = actorOfPrincipal(Principal.make(stored), projectId);
  if (actor === null) {
    return Effect.fail(
      new TerminalUnavailable({
        owner: 'store',
        message: `A stored command origin names a principal this installation never minted: ${stored}`,
      }),
    );
  }
  if (actor._tag === 'Foreign') {
    return Effect.fail(
      new TerminalUnavailable({
        owner: 'store',
        message: `A stored command origin names a foreign session, which owns no command on this installation: ${stored}`,
      }),
    );
  }
  return Effect.succeed(actor._tag === 'Operator' ? { _tag: 'Operator' as const } : { _tag: 'Thread' as const, thread: actor.threadId });
};

export const requestRef = (installation: InstallationId, operationId: string): HostRequestRef => ({
  installation,
  operation: HostRequestKey.make(operationId),
});

export const executionOfKey = (installation: InstallationId, row: RequestKeyRow): ExecutionRef | undefined =>
  row.executionId === null || row.incarnation === null
    ? undefined
    : { installation, execution: ExecutionId.make(row.executionId), incarnation: row.incarnation };

export const requestKeyOf = (installation: InstallationId, row: RequestKeyRow): TerminalOperationKey => {
  const execution = executionOfKey(installation, row);
  return {
    projectId: row.projectId,
    operationId: HostRequestKey.make(row.operationId),
    requester: Principal.make(row.requester),
    mutation: row.mutation,
    targetKey: TargetKey.make(row.targetKey),
    execution: execution,
  };
};

export const terminalOf = (
  installation: InstallationId,
  row: typeof terminal.$inferSelect,
): Effect.Effect<TerminalRecord, TerminalUnavailable> =>
  decoded(decodeRecord, {
    projectId: row.projectId,
    execution: { installation, execution: row.executionId, incarnation: row.incarnation },
    transport: row.transport,
    lifetime: row.lifetime,
    targetKey: row.targetKey,
    holder: row.holder,
    origin: row.origin,
    revision: row.revision,
    holdings: {
      rootUse: row.rootUseId ?? undefined,
      environmentUse: row.environmentUseId ?? undefined,
    },
    heldBy: row.heldByThread ?? undefined,
    label: row.label ?? undefined,
    commandLine: row.commandLine ?? undefined,
    program: row.program ?? undefined,
    cwd: row.cwd ?? undefined,
    quarantine: row.quarantine ?? undefined,
    rootId: row.rootId ?? undefined,
    launchedFor: row.launchedFor ?? undefined,
    shellKey: row.shellKey ?? undefined,
    acceptedAt: row.acceptedAt.getTime(),
  });

export const commandRecordOf = (input: unknown): Effect.Effect<CommandRecord, TerminalUnavailable> => decoded(decodeCommandRecord, input);

export const commandOf = Effect.fnUntraced(function* (
  installation: InstallationId,
  row: typeof command.$inferSelect,
): Effect.fn.Return<CommandRecord, TerminalUnavailable> {
  const owner =
    row.serviceScope !== null ? { _tag: 'Service' as const, scope: row.serviceScope } : yield* armOfStored(row.owner, row.projectId);
  const created = yield* armOfStored(row.createdBy, row.projectId);
  if (created._tag === 'Operator' && (row.createdRun !== null || row.createdToolCall !== null)) {
    return yield* new TerminalUnavailable({
      owner: 'store',
      message: 'A stored command origin mixes an operator birth with thread facts.',
    });
  }
  return yield* decoded(decodeCommandRecord, {
    projectId: row.projectId,
    execution: { installation, execution: row.executionId, incarnation: row.incarnation },
    owner,
    origin:
      created._tag === 'Operator'
        ? created
        : {
            ...created,
            run: row.createdRun ?? undefined,
            toolCall: row.createdToolCall ?? undefined,
          },
    policyIdentity: row.policyIdentity,
    targetKey: row.targetKey,
    holdings: {
      rootUse: row.rootUseId ?? undefined,
      environmentUse: row.environmentUseId ?? undefined,
    },
    label: row.label ?? undefined,
    commandLine: row.commandLine ?? undefined,
    program: row.program ?? undefined,
    cwd: row.cwd ?? undefined,
    ...storedTime(row.time),
    rootId: row.rootId ?? undefined,
    admittedAt: row.admittedAt.getTime(),
  });
});

export const commandWaitOf = (
  execution: ExecutionRef,
  mode: CommandWaitMode,
  revision: number,
): Effect.Effect<CommandWait, TerminalUnavailable> => decoded(decodeCommandWait, { execution, mode, revision });

export const commandStateOf = Effect.fnUntraced(function* (
  installation: InstallationId,
  row: typeof command.$inferSelect,
  wait: typeof commandWait.$inferSelect | null,
): Effect.fn.Return<CommandState, TerminalUnavailable> {
  const record = yield* commandOf(installation, row);
  return {
    record,
    wait: wait === null ? null : yield* commandWaitOf(record.execution, wait.mode, wait.revision),
  };
});

export const noticeOf = (installation: InstallationId, row: typeof custodyNotice.$inferSelect): CustodyNotice => ({
  projectId: row.projectId,
  operationId: row.operationId,
  thread: row.threadId,
  requester: row.requester,
  execution: { installation, execution: ExecutionId.make(row.executionId), incarnation: row.incarnation },
  expected: row.expected,
  name: row.name,
  state: row.state,
  openedAt: row.openedAt.getTime(),
});

export const deliveryOf = (
  installation: InstallationId,
  row: typeof commandDelivery.$inferSelect,
): Effect.Effect<CommandDelivery, TerminalUnavailable> =>
  decoded(decodeCommandDelivery, {
    execution: { installation, execution: row.executionId, incarnation: row.incarnation },
    thread: row.threadId,
    signalId: row.signalId,
    text: row.text ?? undefined,
    openedAt: row.openedAt.getTime(),
  });
