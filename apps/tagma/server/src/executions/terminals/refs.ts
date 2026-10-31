import { Effect } from 'effect';
import type { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef, HostRequestKey } from '@runlith/executions/protocol/execution';
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

export type StopDispatches = ReturnType<typeof makeStopDispatches>;

export const makeStopDispatches = () => {
  const active = new Set<string>();
  const named = (projectId: number, operation: HostRequestKey) => `${projectId}:${operation}`;
  return {
    has: (projectId: number, operation: HostRequestKey) => active.has(named(projectId, operation)),
    hold: Effect.fnUntraced(function* <A, E, R>(key: TerminalOperationKey, work: Effect.Effect<A, E, R>) {
      const name = named(key.projectId, key.operationId);
      return yield* Effect.acquireUseRelease(
        Effect.suspend(() => {
          if (active.has(name)) {
            return new TerminalRefused({
              reason: 'operation-conflict',
              message: `Operation ${key.operationId} has a live stop dispatch; read it rather than sending it again.`,
            });
          }
          active.add(name);
          return Effect.void;
        }),
        () => work,
        () =>
          Effect.sync(() => {
            active.delete(name);
          }),
      );
    }),
  };
};

export const retaken = Effect.fn('Terminals.retaken')(function* (
  key: TerminalOperationKey,
  state: TerminalOperationState,
): Effect.fn.Return<never, TerminalFailure> {
  return yield* new TerminalRefused({
    reason: state._tag === 'Expired' ? 'operation-expired' : 'operation-conflict',
    message: `Operation ${key.operationId} is already taken and stands at ${state._tag}; read that operation rather than sending it again.`,
  });
});
