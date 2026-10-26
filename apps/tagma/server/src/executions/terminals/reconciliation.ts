import { Clock, Context, Effect } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import { Executions } from '@runlith/executions/Executions';
import type { ExecutionRef, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import {
  command,
  commandDelivery,
  commandWait,
  openTerminal,
  terminal,
  terminalIntent,
  terminalRequestKey,
  terminalRequestKeyTally,
} from '../store/terminal.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { actorOfPrincipal } from './principals.js';
import { type TerminalIntent, type TerminalQuarantine, type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { TerminalGrants } from '../contract/service/grants.js';
import type { ExecutionStoreFailure } from '../store/rows.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { TerminalRows } from '../store/terminalRows.js';
import { CommandRows } from '../store/commandRows.js';

export type TerminalReconciliation = Effect.Success<ReturnType<typeof makeTerminalReconciliation>>;

export const TerminalReconciliation = Context.Service<TerminalReconciliation>('tagma/executions/TerminalReconciliation');

export const makeTerminalReconciliation = Effect.fnUntraced(function* ({ installation }: { readonly installation: InstallationId }) {
  const executions = yield* Executions;
  const requestKeys = yield* RequestKeys;
  const intents = yield* TerminalIntents;
  const terminalRows = yield* TerminalRows;
  const commandRows = yield* CommandRows;
  const grants = yield* TerminalGrants;
  const units = yield* MachineUnits;

  const write = Effect.fn('TerminalReconciliation.write')(function* (
    projectId: number,
    execution: ExecutionRef,
    summary: ExecutionSummary,
    key: TerminalOperationKey,
    intent: TerminalIntent | null,
  ) {
    if (summary.state.lifetime === 'command') {
      const origin = yield* units.read((unit) => intents.commandOrigin(unit, key.projectId, key.operationId));
      if (origin === null) return null;
      const record = yield* units.write(writes('TerminalReconciliation.record', [command, commandWait, commandDelivery]), (unit) =>
        commandRows.admitCommand(unit, key, execution),
      );
      return { _tag: 'Command', record } as const;
    }
    const quarantine = suspect(installation, execution, summary, projectId, intent);
    const thread = actorOfPrincipal(summary.custody.holder, projectId);
    const record: TerminalRecord = {
      projectId,
      execution,
      transport: summary.state.transport,
      lifetime: summary.state.lifetime,
      targetKey: key.targetKey,
      holder: summary.custody.holder,
      origin: summary.custody.origin,
      revision: summary.custody.revision,
      holdings: intent?.holdings ?? {},
      heldBy: thread !== null && thread._tag === 'Thread' ? ThreadId.make(thread.threadId) : undefined,
      quarantine: quarantine ?? undefined,
      rootId: intent?.rootId,
      launchedFor: intent?.launchedFor,
      shellKey: intent?.shellKey,
      acceptedAt: yield* Clock.currentTimeMillis,
    };
    yield* units.write(writes('TerminalReconciliation.write', [terminal, openTerminal]), (unit) => terminalRows.project(unit, record));
    return { _tag: 'Terminal', record } as const;
  });

  return {
    projection: Effect.fn('TerminalReconciliation.projection')(function* (projectId: number, execution: ExecutionRef) {
      const standing = yield* units.read((unit) => terminalRows.record(unit, execution.execution));
      if (standing !== null) {
        if (standing.execution.incarnation < execution.incarnation) {
          yield* grants.endOver(standing.projectId, standing.execution, 'custodian-replaced');
        }
        return standing;
      }
      const key = yield* units.read((unit) => requestKeys.keyOf(unit, execution.execution, execution.incarnation));
      if (key === null || key.projectId !== projectId) return null;
      const summary = yield* executions.state(execution);
      if (summary === undefined) return null;
      const intent = yield* units.read((unit) => intents.intent(unit, key.projectId, key.operationId));
      const projected = yield* write(key.projectId, execution, summary, key, intent);
      return projected !== null && projected._tag === 'Terminal' ? projected.record : null;
    }),
    operation: Effect.fn('TerminalReconciliation.operation')(function* (projectId: number, operationId: HostRequestKey) {
      const local = yield* units.read((unit) => requestKeys.operation(unit, projectId, operationId));
      if (local._tag !== 'Admitted') return local;
      const intent = yield* units.read((unit) => intents.intent(unit, projectId, operationId));
      const summary = yield* executions.state(local.execution);
      if (summary === undefined) return local;
      yield* write(projectId, local.execution, summary, local.key, intent);
      yield* units.write(
        writes('TerminalReconciliation.operation', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]),
        (unit) =>
          intents.settle(unit, projectId, operationId, {
            _tag: 'Settled',
            executionId: local.execution.execution,
            incarnation: local.execution.incarnation,
          }),
      );
      return yield* units.read((unit) => requestKeys.operation(unit, projectId, operationId));
    }),
  };
});

export type ReconciliationFailure = ExecutionStoreFailure | ExecutionsFailure;

const suspect = (
  installation: InstallationId,
  execution: ExecutionRef,
  summary: ExecutionSummary,
  projectId: number,
  intent: TerminalIntent | null,
): TerminalQuarantine | null => {
  if (execution.installation !== installation) return 'untrusted-provenance';
  const actor = actorOfPrincipal(summary.custody.holder, projectId);
  if (actor === null) return 'unknown-principal';
  if (actor._tag === 'Thread' && intent !== null && fenced(intent) && !names(intent, actor.threadId)) {
    return 'unknown-thread';
  }
  return null;
};

const fenced = (intent: TerminalIntent): boolean => intent.incoming !== undefined || intent.outgoing !== undefined;

const names = (intent: TerminalIntent, threadId: string): boolean => intent.incoming === threadId || intent.outgoing === threadId;
