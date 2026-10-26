import { threadRunInterrupted } from '@runlith/agent/thread/rows';
import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { type KeepWarmPing, keepWarmSignalId } from '@runlith/agent/transcript/keepWarm';
import { Cause, Clock, type Context, Duration, Effect, FiberMap, Queue, type Scope, Stream } from 'effect';
import type { AccountQuota } from '../../providers/contract/service/quota.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { turnSpendability } from '../models/spendability.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { keepWarm, keepWarmPings } from '../contract/wire/settings.js';
import { type KeepWarmLatest, makeKeepWarmReads } from './reads.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { ThreadHarness, ThreadLive } from '../../threads/contract/service/engine.js';
import type { NativeThreadState } from '../../threads/contract/service/state.js';
import type { ThreadSummary } from '../../threads/list/summary.js';
import type { CacheWarmth } from '../../threads/contract/service/evidence.js';
import { cacheWarmthOf } from '../../threads/list/wire.js';

export const KEEP_WARM_MARGIN_MS = 60_000;

export type KeepWarmSubject = {
  readonly on: boolean;
  readonly pings: number;
  readonly archived: boolean;
  readonly running: boolean;
  readonly waits: boolean;
  readonly warmth: ThreadCacheWarmth | null;
  readonly measuredAt: number | null;
  readonly latest: KeepWarmLatest | null;
  readonly spendableFrom: number | null;
};

export type KeepWarmRest =
  | 'off'
  | 'archived'
  | 'running'
  | 'not-waiting'
  | 'no-promise'
  | 'cold'
  | 'never-ran'
  | 'interrupted'
  | 'count'
  | 'tried'
  | 'unspendable';

export type KeepWarmPlan =
  | { readonly kind: 'rest'; readonly reason: KeepWarmRest }
  | { readonly kind: 'at'; readonly at: number }
  | { readonly kind: 'ping'; readonly ping: KeepWarmPing };

const rest = (reason: KeepWarmRest): KeepWarmPlan => ({ kind: 'rest', reason });

export function keepWarmPlan(subject: KeepWarmSubject, now: number, margin: number = KEEP_WARM_MARGIN_MS): KeepWarmPlan {
  if (!subject.on) return rest('off');
  if (subject.archived) return rest('archived');
  if (subject.running) return rest('running');
  if (!subject.waits) return rest('not-waiting');
  const warmth = subject.warmth;
  if (warmth === null || warmth.basis !== 'promise' || warmth.expiresAt === null) return rest('no-promise');
  const expiresAt = Date.parse(warmth.expiresAt);
  if (warmth.state !== 'warm' || !(now < expiresAt)) return rest('cold');
  const latest = subject.latest;
  if (latest === null) return rest('never-ran');
  if (threadRunInterrupted(latest.status)) return rest('interrupted');
  const sent = latest.ping?.ping ?? 0;
  if (sent >= subject.pings) return rest('count');
  if (latest.ping !== null && (subject.measuredAt === null || latest.ping.sentAt > subject.measuredAt)) return rest('tried');
  const at = expiresAt - margin;
  if (now < at) return { kind: 'at', at };
  const spendable = subject.spendableFrom;
  if (spendable === null || spendable > expiresAt - margin / 2) return rest('unspendable');
  if (now < spendable) return { kind: 'at', at: spendable };
  return { kind: 'ping', ping: { anchor: latest.ping?.anchor ?? latest.runId, ping: sent + 1 } };
}

export type KeepWarmSettings = (projectId: number) => Effect.Effect<{ readonly on: boolean; readonly pings: number }, unknown>;

export type KeepWarmWarmth = (thread: ThreadSummary) => Effect.Effect<ThreadCacheWarmth | null, unknown>;

export type KeepWarmSpending = (thread: ThreadSummary, now: number) => Effect.Effect<number | null>;

export const keepWarmSettings =
  (settings: Context.Service.Shape<typeof Settings>): KeepWarmSettings =>
  (projectId) =>
    Effect.all({ on: settings.value(keepWarm, projectId), pings: settings.value(keepWarmPings, projectId) });

export const keepWarmSettingChanges = (
  settings: Context.Service.Shape<typeof Settings>,
): Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope> =>
  Effect.map(Effect.all([settings.changes(keepWarm), settings.changes(keepWarmPings)]), ([switched, counted]): Stream.Stream<unknown> =>
    Stream.merge(switched, counted),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning('keep-warm reads no setting changes; a changed setting reaches a thread at its next frame', {
        reason: Cause.pretty(cause),
      }).pipe(Effect.as(Stream.empty)),
    ),
  );

export const keepWarmWarmth =
  (evidence: CacheWarmth['Service']): KeepWarmWarmth =>
  (thread) =>
    Effect.map(evidence.warmthBasis([thread]), (basis) => cacheWarmthOf(thread, false, basis));

export const keepWarmSpending = (quota: AccountQuota['Service'], providers: ProviderRegistry['Service']): KeepWarmSpending =>
  Effect.fnUntraced(function* (thread: ThreadSummary, now: number) {
    const table = yield* quota.table();
    const catalog = yield* providers.catalog;
    const model = resolvedModel(catalog.models, thread.provider, thread.model);
    if (model === null) return null;
    const verdict = turnSpendability(catalog, thread.provider, model, table, now, thread.account);
    return verdict.spendable ? now : (verdict.until ?? null);
  });

type Look = { readonly threadId: string; readonly busy: boolean; readonly climb: boolean };

export type KeepWarmInput = {
  readonly settings: KeepWarmSettings;
  readonly warmth: KeepWarmWarmth;
  readonly spending: KeepWarmSpending;
  readonly marginMs?: number;
};

export const makeKeepWarm = Effect.fnUntraced(function* ({ settings, warmth, spending, marginMs = KEEP_WARM_MARGIN_MS }: KeepWarmInput) {
  const reads = yield* makeKeepWarmReads;
  const threads = yield* ThreadLookup;
  const harness = yield* ThreadHarness;
  const live = yield* ThreadLive;
  const working = new Set<string>();

  const framed = (state: NativeThreadState, looks: Queue.Queue<Look>): void => {
    const threadId = state.thread.id;
    const busy = state.status.life !== 'idle';
    const was = working.has(threadId);
    if (busy) working.add(threadId);
    else working.delete(threadId);
    Queue.offerUnsafe(looks, { threadId, busy, climb: false });
    if (busy !== was && state.thread.parentThreadId !== null) {
      Queue.offerUnsafe(looks, { threadId: state.thread.parentThreadId, busy: false, climb: true });
    }
  };

  const subject = Effect.fnUntraced(function* (threadId: string, now: number): Effect.fn.Return<KeepWarmSubject | null, unknown> {
    const summary = yield* threads.summary(threadId);
    if (summary === undefined || summary.ownerId !== OPERATOR_PRINCIPAL) return null;
    const { on, pings } = yield* settings(summary.projectId);
    const running = summary.activeRun !== null;
    const measuredAt = summary.contextReading === null ? Number.NaN : Date.parse(summary.contextReading.measuredAt);
    const settled = on && !running && summary.archivedAt === null;
    return {
      on,
      pings,
      archived: summary.archivedAt !== null,
      running,
      waits: true,
      warmth: settled ? yield* warmth(summary) : null,
      measuredAt: Number.isFinite(measuredAt) ? measuredAt : null,
      latest: settled ? yield* reads.latest(threadId) : null,
      spendableFrom: settled ? yield* spending(summary, now) : null,
    };
  });

  const look = Effect.fnUntraced(
    function* (look: Look, looks: Queue.Queue<Look>, timers: FiberMap.FiberMap<string>) {
      yield* FiberMap.remove(timers, look.threadId);
      if (look.busy) return;
      const standing = yield* reads.standing(look.threadId);
      if (standing === null) return;
      if (look.climb && standing.parentThreadId !== null) {
        yield* Queue.offer(looks, { threadId: standing.parentThreadId, busy: false, climb: true });
      }
      if (!standing.waits) return;
      const now = yield* Clock.currentTimeMillis;
      const judged = yield* subject(look.threadId, now);
      if (judged === null) return;
      const plan = keepWarmPlan(judged, now, marginMs);
      if (plan.kind === 'at') {
        yield* FiberMap.run(
          timers,
          look.threadId,
          Effect.sleep(Duration.millis(plan.at - now)).pipe(
            Effect.andThen(Queue.offer(looks, { threadId: look.threadId, busy: false, climb: false })),
            Effect.asVoid,
          ),
        );
        return;
      }
      if (plan.kind !== 'ping') return;
      const sent = yield* harness.threads.handle(look.threadId, OPERATOR_PRINCIPAL).keepWarm(keepWarmSignalId(plan.ping));
      yield* Effect.logInfo('keep-warm pinged a waiting thread', {
        threadId: look.threadId,
        ping: plan.ping.ping,
        status: sent.status,
      });
    },
    (effect, look) =>
      Effect.catchCause(effect, (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning('keep-warm could not judge a thread', { threadId: look.threadId, reason: Cause.pretty(cause) }),
      ),
  );

  const drive = Effect.fnUntraced(function* (changes: Stream.Stream<unknown> = Stream.empty): Effect.fn.Return<never, never, Scope.Scope> {
    const looks = yield* Queue.unbounded<Look>();
    const timers = yield* FiberMap.make<string>();
    yield* Effect.acquireRelease(
      Effect.sync(() => live.subscribeStates((state) => framed(state, looks))),
      (detach) => Effect.sync(detach),
    );
    const everyWaiting = reads.waiting().pipe(
      Effect.flatMap((ids) =>
        Effect.forEach(ids, (threadId) => Queue.offer(looks, { threadId, busy: false, climb: false }), { discard: true }),
      ),
      Effect.catchCause((cause) => Effect.logWarning('keep-warm could not read the waiting threads', { reason: Cause.pretty(cause) })),
    );
    yield* Effect.forkScoped(Stream.runForEach(changes, () => everyWaiting));
    yield* everyWaiting;
    return yield* Effect.forever(Queue.take(looks).pipe(Effect.flatMap((next) => look(next, looks, timers))));
  });

  return { drive };
});

function resolvedModel(models: ModelCatalog, provider: string, model: string | null): string | null {
  if (!models.registered(provider)) return null;
  const id = model ?? models.defaultTextModelId(provider);
  return models.modelsFor(provider, 'text').some((option) => option.id === id) ? id : null;
}
