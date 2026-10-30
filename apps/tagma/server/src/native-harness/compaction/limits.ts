import { Cause, Effect, PubSub, Stream } from 'effect';
import type { ModelOption } from '@runlith/llm/models/catalog';
import { plannedOutputTokens } from '@runlith/llm/models/resolve';
import { resolveCompactionTrigger, type ThreadCompactionPolicy } from '@runlith/agent/thread/compaction/policy';
import { compactionThreshold, type ThreadCompactionThreshold, type ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { COMPACTION_OFF } from '@runlith/agent/thread/compaction/strategies';
import type { AgentRegistry } from '@runlith/agent/thread/agents/AgentRegistry';
import type { TransportCapabilities } from '@runlith/agent/thread/record';
import { CompactionPlanning } from '../../threads/contract/service/compaction.js';
import { ContextLimits } from '../../threads/contract/service/limits.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { ThreadList } from '../../threads/contract/service/list.js';
import { ThreadHarness, ThreadLive } from '../../threads/contract/service/engine.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { type ProviderCatalog, ProviderRegistry } from '../../providers/contract/service/registry.js';
import { Settings } from '../../settings/contract/service/values.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { textModelOf } from '../models/spendability.js';
import { COMPACTION_KEYS, COMPACTION_PROMPT, compactionPolicy, projectPolicy } from './policy.js';

export type LimitInput = {
  readonly provider: string;
  readonly model: string | null;
  readonly compaction: TransportCapabilities['compaction'];
  readonly measured: number | null;
  readonly off: boolean;
};

export function contextLimitOf(catalog: ProviderCatalog, policy: ThreadCompactionPolicy, input: LimitInput): ThreadContextLimit | null {
  const session = input.compaction === 'session';
  const provider = session ? contextProvider(catalog, input.provider) : input.provider;
  const model = input.model ?? (session || !catalog.models.registered(provider) ? null : catalog.models.defaultTextModelId(provider));
  const option = model === null ? undefined : textModelOf(catalog.models, provider, model);
  const declared = option?.capacity?.context ?? null;
  const window = input.compaction === 'core' ? (declared ?? input.measured) : (input.measured ?? declared);
  if (window === null) return null;
  const automatic = session || (input.compaction === 'core' && !input.off && option !== undefined);
  return { window, compaction: automatic ? thresholdAt(catalog, policy, provider, model, option, window) : null };
}

function thresholdAt(
  catalog: ProviderCatalog,
  policy: ThreadCompactionPolicy,
  provider: string,
  model: string | null,
  option: ModelOption | undefined,
  window: number,
): ThreadCompactionThreshold {
  const capacity = { ...option?.capacity, context: window };
  const wire = option !== undefined && catalog.wires.registered(provider) ? catalog.wires.named(provider) : null;
  const planned =
    wire === null || option === undefined ? (capacity.output ?? policy.bufferTokens) : plannedOutputTokens(wire.profile.output, option);
  return compactionThreshold(
    capacity,
    planned,
    policy,
    resolveCompactionTrigger({ provider, model, policy, row: option?.compactionTrigger }),
  );
}

const contextProvider = (catalog: ProviderCatalog, provider: string): string => catalog.borrower(provider) ?? provider;

export const makeContextLimits = Effect.fnUntraced(function* (input: { readonly agents: AgentRegistry<WriteUnit<'machine'>> }) {
  const settings = yield* Settings;
  const registry = yield* ProviderRegistry;
  return ContextLimits.of({
    of: Effect.fn('ContextLimits.of')(function* (threads) {
      const table = new Map<string, ThreadContextLimit>();
      if (threads.length === 0) return table;
      const policies = new Map<number, ThreadCompactionPolicy>();
      const known = new Map<ProviderCatalog, Map<string, ThreadContextLimit | null>>();
      for (const thread of threads) {
        const policy = policies.get(thread.projectId) ?? (yield* projectPolicy(settings, thread.projectId));
        policies.set(thread.projectId, policy);
        const catalog = thread.activeRun === null ? registry.current() : registry.forRun(thread.activeRun.id);
        const limitInput: LimitInput = {
          provider: thread.provider,
          model: thread.capabilities.compaction === 'session' ? (thread.model ?? thread.contextReading?.model ?? null) : thread.model,
          compaction: thread.capabilities.compaction,
          measured: thread.contextReading?.contextWindow ?? null,
          off: input.agents.find(thread.agentId)?.compaction === COMPACTION_OFF,
        };
        const key = `${thread.projectId}\u0000${limitInput.provider}\u0000${limitInput.model}\u0000${limitInput.compaction}\u0000${limitInput.measured}\u0000${limitInput.off}`;
        const derived = known.get(catalog) ?? new Map<string, ThreadContextLimit | null>();
        known.set(catalog, derived);
        const limit = derived.has(key) ? derived.get(key)! : contextLimitOf(catalog, policy, limitInput);
        derived.set(key, limit);
        if (limit !== null) table.set(thread.id, limit);
      }
      return table;
    }, Effect.mapError(threadCallFailed)),
  });
});

export const makeCompactionPlanning = Effect.gen(function* () {
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const registry = yield* ProviderRegistry;
  return CompactionPlanning.of({
    instructions: `${COMPACTION_PROMPT.instructions}\n\n${COMPACTION_PROMPT.template}`,
    threshold: Effect.fnUntraced(function* (threadId, harness, model, window) {
      const policy = yield* compactionPolicy(records, settings, threadId);
      const catalog = yield* registry.catalog;
      const provider = contextProvider(catalog, harness);
      const option = model === null ? undefined : textModelOf(catalog.models, provider, model);
      return thresholdAt(catalog, policy, provider, model, option, window).at;
    }, Effect.mapError(threadCallFailed)),
  });
});

export const publishLimitMoves = Effect.gen(function* () {
  const live = yield* ThreadLive;
  const harness = yield* ThreadHarness;
  const list = yield* ThreadList;
  const registry = yield* ProviderRegistry;
  const lookup = yield* ThreadLookup;
  const changes = yield* SettingChanges;
  const moved = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
  let pending: ReadonlySet<number> | 'all' | null = null;
  const mark = (projectId: number | null) =>
    Effect.suspend(() => {
      pending = projectId === null || pending === 'all' ? 'all' : new Set([...(pending ?? []), projectId]);
      return Effect.asVoid(PubSub.publish(moved, undefined));
    });
  const unwatch = changes.subscribe((event) => (COMPACTION_KEYS.has(event.key) ? mark(event.projectId) : Effect.void));
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));
  const reaches = (scope: ReadonlySet<number> | 'all', threadId: string) =>
    scope === 'all' ? Effect.succeed(true) : Effect.map(lookup.summary(threadId), (row) => row !== undefined && scope.has(row.projectId));
  const republish = Effect.fnUntraced(function* () {
    const scope = pending;
    pending = null;
    if (scope === null) return;
    yield* Effect.forEach(
      live.watchedAtRest(),
      (threadId) =>
        reaches(scope, threadId).pipe(
          Effect.flatMap((reached) => (reached ? harness.threads.publish(threadId) : Effect.void)),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning('a context limit moved, but a thread state was not published', { threadId, cause }),
          ),
        ),
      { discard: true },
    );
    if (scope === 'all') list.resync();
    else for (const projectId of scope) list.resync(projectId);
  });
  yield* Effect.forkScoped(Stream.runForEach(Stream.drop(registry.changes, 1), () => mark(null)));
  yield* Stream.runForEach(Stream.fromPubSub(moved), republish);
});
