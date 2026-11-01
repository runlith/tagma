import { Clock, Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { restStamps } from '../rest.js';
import type { ThreadUses } from './uses.js';
import type { SourceRetention } from './sourceRetention.js';
import type { SourcePublication } from './sourceFiles.js';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadResourceStorage } from '@runlith/agent/thread/storage/resources';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { Settings } from '../../settings/contract/service/values.js';
import { gated } from '../projectGate.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { idleProjectionDays } from '../contract/wire/settings.js';
import type { ThreadRunning, ThreadShelving } from '../contract/service/reads.js';
import { evictThreadResources } from '../resources/kinds/evict.js';
import type { ThreadEvictionVerdict, ThreadKept } from '../contract/wire/eviction.js';
import { evictThreadProjection } from './rest.js';
import { based, livingReaders, referenced } from './base.js';
import { heardFromLayers, inheritPrefix } from './inheritance.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { RolloutSyncRefused } from './export.js';
import type { RolloutUnreadable } from './rolloutFile.js';
import { rolloutTransformed } from './rolloutGeneration.js';
import { compressRollout, rolloutStateOf } from './rolloutForms.js';
import type { RolloutContext } from './rolloutContext.js';

const EVICTIONS_PER_PASS = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const rolloutEvicting = (
  ctx: RolloutContext,
  threads: ThreadRunning['Service'] & ThreadShelving['Service'],
  ledger: ThreadResourceStorage<Unit<'machine'>>,
  resourceKinds: () => readonly ThreadResourceKind<Unit<'machine'>>[],
  settings: Context.Service.Shape<typeof Settings>,
  uses: ThreadUses,
  retention: SourceRetention,
  publication: SourcePublication,
  rewrite: (threadId: string) => Effect.Effect<void, HarnessFailure>,
  whole: (threadId: string, path: string) => Effect.Effect<void, RolloutSyncRefused | RolloutUnreadable | StoreFailure>,
) => {
  const { graph, parts, kinds, machineStore, inJournal, locate, records, floor } = ctx;

  const projected = Effect.fnUntraced(function* (threadId: string, returning: boolean, whole = false) {
    const running = yield* threads.activeRunInSubtree(threadId);
    if (running !== null) return { outcome: 'kept', reason: 'running' } as const;
    const path = yield* locate(threadId);
    const verdict = yield* machineStore(evictThreadProjection({ threadId, path, parts, returning, whole }, publication)).pipe(
      Effect.provideService(ThreadEntryKinds, kinds),
    );
    if (verdict.outcome === 'evicted') floor.forget(threadId);
    return verdict;
  });

  const resting = (threadId: string): Effect.Effect<boolean, HarnessFailure> =>
    machineStore(
      Effect.gen(function* () {
        const { db } = yield* MachineStore;
        const row = yield* db.select({ at: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, threadId)).get();
        return row?.at != null;
      }),
    );

  const rest = (threadId: string): Effect.Effect<ThreadEvictionVerdict, HarnessFailure> =>
    retention.using(threadId, projected(threadId, true));

  const inherited = (threadId: string) =>
    machineStore(
      Effect.gen(function* () {
        const { db } = yield* MachineStore;
        const heirs = yield* livingReaders(db, threadId);
        for (const layer of heirs) yield* inheritPrefix(layer, true);
        return [...new Set(heirs.map((layer) => layer.threadId))];
      }),
    );

  const carried = Effect.fnUntraced(function* (threadId: string, path: string) {
    if (!(yield* machineStore(Effect.flatMap(MachineStore, ({ db }) => based(db, threadId))))) return false;
    yield* machineStore(heardFromLayers(threadId, true));
    return yield* whole(threadId, path).pipe(
      Effect.as(true),
      Effect.catchTag(['RolloutUnreadable', 'RolloutSyncRefused'], (failure) =>
        Effect.as(Effect.logWarning(`the rollout of ${threadId} was not written with its prefix`, { reason: failure.message }), null),
      ),
    );
  });

  const evict = (
    projectId: number,
    threadId: string,
    still: Effect.Effect<boolean, HarnessFailure> = Effect.succeed(true),
  ): Effect.Effect<ThreadEvictionVerdict, HarnessFailure> =>
    gated(records, threadId, projectId, () =>
      retention.using(
        threadId,
        inJournal(
          threadId,
          uses.rest(
            threadId,
            Effect.gen(function* () {
              if (!(yield* still)) return { verdict: { outcome: 'kept', reason: 'unarchived' } as const, heirs: [] };
              const path = yield* locate(threadId);
              const standing = !(yield* resting(threadId));
              if (standing && (yield* threads.activeRunInSubtree(threadId)) !== null) {
                return { verdict: { outcome: 'kept', reason: 'running' } as const, heirs: [] };
              }
              const heirs = standing ? yield* inherited(threadId) : [];
              const carrying = standing && path !== undefined ? yield* carried(threadId, path) : false;
              if (carrying === null) return { verdict: { outcome: 'kept', reason: 'unreadable' } as const, heirs };
              if (path !== undefined && standing) {
                const caught = yield* ctx.projection.run({ threadId, path }).pipe(
                  Effect.as(true),
                  Effect.catchTag('ThreadProjectionRefused', () => Effect.succeed(false)),
                );
                if (!caught) return { verdict: { outcome: 'kept', reason: 'cursor-behind' } as const, heirs };
              }
              const verdict = yield* projected(threadId, false, carrying);
              if (verdict.outcome === 'evicted') {
                const reached = yield* machineStore(Effect.flatMap(MachineStore, ({ db }) => referenced(db, threadId)));
                if (!reached) yield* evictThreadResources(ledger, resourceKinds(), threadId);
                if (path !== undefined) {
                  const standing = yield* rolloutStateOf(path);
                  yield* compressRollout(path, rolloutTransformed(Context.get(graph, MachineStore), threadId, path)).pipe(
                    Effect.withSpan('ThreadRollout.evict.compress', {
                      attributes: { threadId, bytes: standing?.bytes },
                    }),
                    Effect.catchTag('RolloutUnreadable', (failure) =>
                      Effect.logWarning(`the rollout of ${threadId} stays plain`, { reason: failure.message }),
                    ),
                  );
                }
              }
              return { verdict, heirs };
            }),
            { verdict: { outcome: 'kept', reason: 'in-use' } as const, heirs: [] },
          ),
        ).pipe(
          Effect.flatMap(({ verdict, heirs }) => Effect.as(Effect.forEach(heirs, rewrite, { discard: true }), verdict)),
          Effect.tap((verdict) =>
            Effect.annotateCurrentSpan({
              outcome: verdict.outcome,
              reason: verdict.outcome === 'kept' ? verdict.reason : undefined,
            }),
          ),
          Effect.withSpan('ThreadRollout.evict', { attributes: { threadId } }),
        ),
      ),
    );

  const sweep = Effect.fnUntraced(function* () {
    const now = yield* Clock.currentTimeMillis;
    const evicted: string[] = [];
    const kept: ThreadKept[] = [];
    const off: number[] = [];
    let remaining = 0;
    let budget = EVICTIONS_PER_PASS;
    for (const projectId of yield* threads.restingProjects()) {
      const days = yield* settings.value(idleProjectionDays, projectId);
      if (days <= 0) {
        off.push(projectId);
        continue;
      }
      const before = new Date(now - days * DAY_MS);
      for (const threadId of yield* threads.restingPast(projectId, before)) {
        if (budget <= 0) {
          remaining += 1;
          continue;
        }
        budget -= 1;
        const verdict = yield* evict(projectId, threadId);
        if (verdict.outcome === 'evicted') evicted.push(threadId);
        else kept.push({ threadId, reason: verdict.reason });
      }
    }
    if (evicted.length > 0 || kept.length > 0 || remaining > 0) {
      yield* Effect.logInfo('thread projections swept', {
        evicted: evicted.length,
        remaining,
        kept: kept.map((row) => `${row.threadId}: ${row.reason}`),
      });
    }
    return { evicted, kept, off, remaining };
  });

  return { evict, rest, sweep };
};
