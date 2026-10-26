import { Cause, Effect, type Exit } from 'effect';
import { AgentToolFailed, type AgentToolProjection } from '../AgentFailure';

export class DoorMisuse extends Error {}

export const failedEnding = (exit: Exit.Failure<unknown, unknown>): { readonly outcome: 'cancelled' | 'failed' } =>
  Cause.hasInterruptsOnly(exit.cause) ? { outcome: 'cancelled' } : { outcome: 'failed' };

export const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const projected = <A>(
  toolName: string,
  toolCallId: string,
  projection: AgentToolProjection,
  project: () => A,
): Effect.Effect<A, AgentToolFailed> =>
  Effect.try({
    try: project,
    catch: (cause) => new AgentToolFailed({ toolName, toolCallId, projection, cause }),
  });
