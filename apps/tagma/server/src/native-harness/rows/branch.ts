import { Effect } from 'effect';
import { and, eq, or, sql } from 'drizzle-orm';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadBranchBase, ThreadBranchSeed } from '@runlith/agent/thread/storage/aggregate';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { threadEntry } from '../../threads/store/kernel.js';
import { threadBase, threadEvent, threadRolloutForm } from '../../threads/store/journal.js';
import { conversationBehind, conversationInherited } from '../../threads/journal/conversationIndex.js';
import { armsOf, type BaseLayer, eventsOf, journalHead, layersOf, referrersOf } from '../../threads/journal/base.js';
import { foldedBody } from '../../threads/journal/foldedFacts.js';
import { restStamps } from '../../threads/rest.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { threadLog } from '../store/thread.js';
import type { FoldWriter } from '../transcript/foldWrite.js';

export const makeThreadBranching = Effect.fnUntraced(function* ({ folds }: { readonly folds: FoldWriter }) {
  const { db } = yield* MachineStore;
  const layered = folds.entries.layered;

  const opening = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, sourceId: string, turns: number) {
    const said = yield* layered.newest(
      unit,
      sourceId,
      or(eq(threadEntry.type, 'signal'), and(eq(threadEntry.type, 'message'), sql`${threadEntry.entry} ->> '$.role' = 'user'`)),
      turns + 1,
    );
    if (said.length <= turns) return null;
    return said[turns - 1] ?? null;
  });

  const branch = Effect.fn('ThreadStore.branch')(function* (seed: ThreadBranchSeed, unit: WriteUnit<'machine'>) {
    yield* Effect.annotateCurrentSpan({ sourceId: seed.sourceId, threadId: seed.childId, carried: seed.entries.kind });
    const rest = yield* unit.run(db.select({ at: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, seed.sourceId)).get());
    if (rest?.at != null) {
      return yield* new ThreadStorageFailed({
        call: 'branch',
        cause: new Error(`Thread ${seed.sourceId} rests in its rollout; it returns to SQL before a branch references it.`),
      });
    }
    if (seed.entries.kind === 'none') return { through: 0, from: null } satisfies ThreadBranchBase;
    yield* folds.entries.project(unit, seed.sourceId);
    const [standing] = yield* unit.run(
      db.all<{ head: number; low: number | null; high: number | null }>(sql`select ${journalHead(sql`${seed.sourceId}`)} as head,
        (select min(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${seed.sourceId}) as low,
        (select max(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${seed.sourceId}) as high`),
    );
    const through = standing?.head ?? 0;
    const opened = seed.entries.kind === 'turns' ? yield* opening(unit, seed.sourceId, seed.entries.turns) : null;
    const floor = opened?.ord ?? Number.MIN_SAFE_INTEGER;
    const hidden = seed.entries.kind === 'kept' ? seed.entries.taken : [];
    const inherited = yield* layersOf(db, unit, seed.sourceId);
    const own = {
      depth: (inherited[inherited.length - 1]?.depth ?? -1) + 1,
      sourceId: seed.sourceId,
      lowOrd: standing?.low ?? 1,
      highOrd: standing?.high ?? 0,
      afterPosition: 0,
      throughPosition: through,
      prompts: seed.prompts,
      hidden: [] as readonly string[],
    };
    const layers = [...inherited, own].map((layer) => ({
      threadId: seed.childId,
      depth: layer.depth,
      sourceId: layer.sourceId,
      lowOrd: Math.max(layer.lowOrd, floor),
      highOrd: layer.highOrd,
      afterPosition: layer.afterPosition,
      throughPosition: layer.throughPosition,
      prompts: seed.prompts === 'dropped' ? ('dropped' as const) : layer.prompts,
      hidden: [...new Set([...layer.hidden, ...hidden])],
    }));
    yield* unit.run(db.insert(threadBase).values(layers));
    yield* unit.run(
      db
        .update(threadLog)
        .set({ historyThrough: through, entriesThrough: through, strippedThrough: through, footprintsThrough: through })
        .where(eq(threadLog.threadId, seed.childId)),
    );
    yield* unit.run(
      db.run(sql`update ${threadRolloutForm}
        set step = (select formed.step from ${threadRolloutForm} as formed where formed.thread_id = ${seed.sourceId}),
            refusal = (select formed.refusal from ${threadRolloutForm} as formed where formed.thread_id = ${seed.sourceId})
        where ${threadRolloutForm.threadId} = ${seed.childId}`),
    );
    yield* conversationBehind(db, unit, seed.childId, through, through);
    folds.entries.forget(unit, seed.childId);
    folds.history.forget(unit, seed.childId);
    yield* Effect.annotateCurrentSpan({ through, layers: layers.length });
    return { through, from: opened?.entryId ?? null } satisfies ThreadBranchBase;
  });

  const heard = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, layer: BaseLayer, first: boolean) {
    if (!first) {
      const head = yield* unit.run(db.get<{ head: number }>(sql`select ${journalHead(sql`${layer.threadId}`)} as head`));
      return yield* conversationBehind(db, unit, layer.threadId, head?.head ?? 0);
    }
    yield* conversationInherited(db, unit, layer);
  });

  const inherit = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, layer: BaseLayer, first: boolean) {
    const layers = yield* layersOf(db, unit, layer.threadId);
    const arm = armsOf(layer.threadId, layers).find((candidate) => candidate.layer?.depth === layer.depth);
    if (arm !== undefined) {
      yield* unit.run(
        db.run(sql`insert into ${threadEntry} (thread_id, ord, entry_id, run_id, type, entry)
          select ${layer.threadId}, ${threadEntry.ord}, ${threadEntry.entryId}, ${threadEntry.runId}, ${threadEntry.type}, ${threadEntry.entry}
            from ${threadEntry} where ${arm.where}
          on conflict do nothing`),
      );
    }
    yield* unit.run(
      db.run(sql`insert into ${threadEvent} (thread_id, position, id, kind, payload)
        select ${layer.threadId}, ${threadEvent.position}, ${`${layer.threadId}:`} || ${threadEvent.position}, ${threadEvent.kind},
          case when ${threadEntry.entry} is null then ${threadEvent.payload}
            else json_set(json_remove(${threadEvent.payload}, '$.bodyInFold'), '$.entry', json(${threadEntry.entry})) end
          from ${threadEvent} left join ${threadEntry} on ${foldedBody}
         where ${threadEvent.threadId} = ${layer.sourceId}
           and ${threadEvent.position} > ${layer.afterPosition} and ${threadEvent.position} <= ${layer.throughPosition}
           and ${eventsOf(layer.threadId, layers)}`),
    );
    yield* heard(unit, layer, first);
    yield* unit.run(
      db
        .update(threadBase)
        .set({ lowOrd: 1, highOrd: 0, afterPosition: layer.throughPosition, unfiled: true })
        .where(and(eq(threadBase.threadId, layer.threadId), eq(threadBase.depth, layer.depth))),
    );
  });

  const release = Effect.fn('ThreadStore.release')(function* (unit: WriteUnit<'machine'>, ids: readonly string[]) {
    const gone = new Set(ids);
    let heirs = 0;
    for (const id of ids) {
      const living = (yield* referrersOf(db, unit, id)).filter(
        (layer) => !gone.has(layer.threadId) && layer.afterPosition < layer.throughPosition,
      );
      for (const [at, layer] of living.entries()) yield* inherit(unit, layer, at === 0);
      heirs += living.length;
    }
    yield* Effect.annotateCurrentSpan({ heirs });
  });

  return {
    branch: (seed: ThreadBranchSeed, unit: WriteUnit<'machine'>) => failedAs('branch', branch(seed, unit)),
    release,
  };
});
