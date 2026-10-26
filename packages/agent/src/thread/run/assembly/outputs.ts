import { Cause, type Context, Effect } from 'effect';
import type { CallHooks } from '../../../agent/AgentCalls';
import type { ThreadProfileBirth } from '../../agents/AgentProfile';
import type { ThreadSources, ThreadSupplyPlan } from '../../agents/supply';
import type { ThreadStorageFailed } from '../../persisted';
import type { ThreadPortRefusal } from '../../ThreadBorder';
import type { ThreadToolOutputScopeFaces, ThreadToolOutputVault } from '../../ThreadPorts';

export function callRetention(closing: Effect.Effect<void>): {
  readonly hooks: CallHooks;
  readonly runEnded: Effect.Effect<void>;
} {
  const claims = new Set<object>();
  let done = false;
  let closed = false;
  const closeIfLast = (): Effect.Effect<void> => {
    if (!done || closed || claims.size > 0) return Effect.void;
    closed = true;
    return closing;
  };
  return {
    hooks: {
      retain: () =>
        Effect.sync(() => {
          const claim = {};
          claims.add(claim);
          return {
            release: Effect.suspend(() => {
              claims.delete(claim);
              return closeIfLast();
            }),
          };
        }),
      completed: () => Effect.void,
    },
    runEnded: Effect.suspend(() => {
      done = true;
      return closeIfLast();
    }),
  };
}

export type RunOutputs = {
  readonly outputScope: ReturnType<Context.Service.Shape<typeof ThreadToolOutputVault>['scope']>;
  readonly retention: ReturnType<typeof callRetention>;
  readonly heldScope: ThreadToolOutputScopeFaces;
  readonly supply: ThreadSupplyPlan;
};

export function runOutputs(
  vault: Context.Service.Shape<typeof ThreadToolOutputVault>,
  input: {
    readonly thread: { readonly id: string; readonly ownerId: string; readonly profile: ThreadProfileBirth | null };
    readonly run: { readonly id: string };
  },
  sources: ThreadSources,
): RunOutputs {
  const outputScope = vault.scope({
    threadId: input.thread.id,
    ownerId: input.thread.ownerId,
    runId: input.run.id,
  });
  let scopeClosed = false;
  const retention = callRetention(
    Effect.suspend(() => {
      if (scopeClosed) return Effect.void;
      scopeClosed = true;
      return outputScope
        .dispose()
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning('tool output dispose failed', { runId: input.run.id, reason: Cause.pretty(cause) }),
          ),
        );
    }),
  );
  const heldScope: ThreadToolOutputScopeFaces = {
    tools: outputScope.tools,
    project: (given) => outputScope.project(given),
    projectMessages: (messages) => outputScope.projectMessages(messages),
    retainInterrupted: (given) => outputScope.retainInterrupted(given),
    retainOpen: (given) => outputScope.retainOpen(given),
    commitReferenced: (messages, entries, tx) => outputScope.commitReferenced(messages, entries, tx),
    dispose: (): Effect.Effect<void, ThreadStorageFailed | ThreadPortRefusal> => retention.runEnded,
    keepPicture: outputScope.keepPicture,
  };
  return {
    outputScope,
    retention,
    heldScope,
    supply: { sources, outputTools: outputScope.tools },
  };
}
