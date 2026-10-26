import { Effect } from 'effect';
import type { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { TerminalOperationKey, TerminalOperationState } from '../contract/wire/requestKeys.js';
import type { TerminalFailure } from '../contract/service/terminals.js';

export const sameRef = (one: ExecutionRef, other: ExecutionRef): boolean =>
  one.installation === other.installation && one.execution === other.execution && one.incarnation === other.incarnation;

export const refKey = (ref: ExecutionRef): string => `${ref.installation}/${ref.execution}/${ref.incarnation}`;

export const agentLaneKey = (projectId: number, execution: ExecutionRef, principal: Principal, runId: string | undefined): string =>
  JSON.stringify([projectId, execution.installation, execution.execution, execution.incarnation, principal, runId ?? null]);

export function threadOf(principal: Principal): string | null {
  return principal.startsWith('thread:') ? principal.slice('thread:'.length) : null;
}

export const retaken = Effect.fn('Terminals.retaken')(function* (
  key: TerminalOperationKey,
  state: TerminalOperationState,
): Effect.fn.Return<never, TerminalFailure> {
  return yield* new TerminalRefused({
    reason: state._tag === 'Expired' ? 'operation-expired' : 'operation-conflict',
    message: `Operation ${key.operationId} is already taken and stands at ${state._tag}; read that operation rather than sending it again.`,
  });
});
