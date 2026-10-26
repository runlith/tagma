import type { ModelRequester } from '@runlith/agent/modelPort';
import type { ThreadContextUse, ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import type { ServedWeb, WebLifetimes, WebMemory } from '@runlith/llm/profiles/vendorWeb';
import type { WebCache } from '@runlith/llm/profiles/webCache';
import { Effect, type Context } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { agentWeb } from '../../threads/contract/wire/settings.js';
import type { NativeThreadRows } from '../rows/native.js';

const TAGMA_WEB = `set ${agentWeb.id} to tagma to search and read with the tools Tagma ships`;

export type ThreadWeb =
  | { readonly source: 'tagma' }
  | { readonly source: 'hosted' }
  | { readonly source: 'vendor'; readonly web: ServedWeb; readonly memory: (lifetimes: WebLifetimes) => WebMemory };

export type WebModel = {
  readonly provider: string;
  readonly model: string | null;
};

export const threadWeb = Effect.fnUntraced(function* (
  threads: NativeThreadRows,
  settings: Context.Service.Shape<typeof Settings>,
  models: ModelRequester,
  memory: WebCache,
  thread: ThreadView,
  projectId: number,
  runId: string | null,
): Effect.fn.Return<ThreadWeb, StoreFailure | GateRefusal> {
  if ((yield* settings.value(agentWeb, projectId)) === 'tagma') return { source: 'tagma' };
  const road = yield* threads.road(thread.id);
  if (road.transport.agent !== null) return road.capabilities.web === 'vendor' ? { source: 'hosted' } : { source: 'tagma' };
  const request = models.request({
    ownerId: thread.ownerId,
    runId: runId ?? undefined,
    provider: thread.provider,
    model: thread.model,
    reasoning: thread.reasoning,
    switches: thread.switches,
    cacheGroup: thread.cacheGroup,
    lane: thread.id,
    account: thread.account ?? undefined,
  });
  if (request.web === undefined) return { source: 'tagma' };
  const web = yield* request.web.pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal(
          'web-unavailable',
          failure.message,
          failure.reason._tag === 'Authentication' ? ['sign in to the provider again', TAGMA_WEB] : [TAGMA_WEB],
        ),
    ),
  );
  return { source: 'vendor', web, memory: (lifetimes) => memory.view(thread.id, lifetimes) };
});

type Held = WebModel & { readonly web: ThreadWeb };

export type RunWebs = ReturnType<typeof runWebs>;

export const runWebs = (memory: WebCache) => {
  const held = new Map<string, Held>();
  return {
    memory,
    of: <E>(use: ThreadContextUse, on: WebModel, decide: Effect.Effect<ThreadWeb, E>): Effect.Effect<ThreadWeb, E> => {
      const runId = use.runId;
      if (runId === null) return decide;
      const standing = use.kind === 'run' && use.context === null ? undefined : held.get(runId);
      if (standing !== undefined && standing.provider === on.provider && standing.model === on.model) return Effect.succeed(standing.web);
      return Effect.tap(decide, (web) =>
        Effect.sync(() => {
          held.set(runId, { provider: on.provider, model: on.model, web });
        }),
      );
    },
    release: (runId: string) =>
      Effect.sync(() => {
        held.delete(runId);
      }),
  };
};
