import { Effect } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadAtomicPatch } from '@runlith/agent/thread/storage/aggregate';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { ProgramUnit, WriteUnit } from '../../platform/contract/service/units.js';
import { unplannable } from '../../platform/store/programs.js';
import { bindQuery } from '../../platform/store/queries.js';
import { thread } from '../../threads/store/kernel.js';
import { plannedFacts } from '../../threads/journal/log.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { applyPatch } from '../patch.js';
import { makeCacheObservationStore } from '../models/cacheObservations.js';
import { makeHistoryStore } from './history.js';
import { makeEntryFold } from './fold.js';
import type { RestedFolds } from './restedFolds.js';
import { ModelChanges } from '../../threads/contract/service/modelChanges.js';

export type FoldWriter = Effect.Success<ReturnType<typeof makeFoldWriter>>;

export const makeFoldWriter = Effect.fnUntraced(function* (input: { readonly reads: RestedFolds | undefined }) {
  const { db } = yield* MachineStore;
  const records = yield* ThreadRecords;
  const models = yield* ModelChanges;
  const history = yield* makeHistoryStore(input);
  const entries = yield* makeEntryFold(input);
  const observations = yield* makeCacheObservationStore;
  const stamped = {
    touched: db
      .update(thread)
      .set({ updatedAt: sql.placeholder('updatedAt') })
      .where(eq(thread.id, sql.placeholder('id')))
      .prepare(),
    reading: db
      .update(thread)
      .set({ contextReading: sql.placeholder('reading'), updatedAt: sql.placeholder('updatedAt') })
      .where(eq(thread.id, sql.placeholder('id')))
      .prepare(),
  };
  return {
    history,
    entries,
    write: Effect.fnUntraced(function* (
      call: string,
      unit: WriteUnit<'machine'>,
      id: string,
      fold: ThreadAtomicPatch,
      standing: number,
      materialized: Set<string>,
      at: Date,
    ) {
      const { history: next, covered, placements, cacheObservations, ...columns } = fold;
      if (next !== undefined) {
        if (covered !== undefined && covered !== null && (covered.from > standing || covered.through < standing)) {
          return yield* new ThreadStorageFailed({
            call,
            cause: new Error(
              `Thread ${id}: the returned history was folded over positions ${covered.from + 1}-${covered.through}, but the log stood at ${standing} when the history was read. The facts between are covered by no fold, so this unit cannot advance the history cursor.`,
            ),
          });
        }
        yield* history.write(unit, id, next, covered === undefined || covered === null ? standing : covered.through);
      }
      for (const entryId of (yield* entries.project(unit, id)).claimed) materialized.add(entryId);
      if (placements !== undefined && placements.length > 0) {
        yield* entries.place(
          unit,
          id,
          placements.filter(
            (placement) => placement.kind === 'withdraw' || placement.kind === 'mark' || !materialized.has(placement.entry.id),
          ),
        );
      }
      yield* history.project(unit, id);
      for (const observation of cacheObservations ?? []) yield* observations.append(id, observation, unit);
      yield* applyPatch(db, records, models, unit, id, columns, at);
    }),
    plan: Effect.fnUntraced(function* (program: ProgramUnit<'machine'>, id: string, fold: ThreadAtomicPatch, standing: number, at: Date) {
      const { history: next, covered, placements, cacheObservations, ...columns } = fold;
      if ((cacheObservations?.length ?? 0) > 0) return yield* unplannable(program, 'cache observations');
      const patched = Object.entries(columns).filter(([, value]) => value !== undefined);
      if (patched.some(([key]) => key !== 'contextReading')) return yield* unplannable(program, 'a patch beyond the context reading');
      if (next !== undefined && covered != null && (covered.from > standing || covered.through < standing))
        return yield* unplannable(program, 'a history fold that covers no standing position');
      const facts = plannedFacts(program, id) ?? [];
      yield* history.plan(program, id, next, covered == null ? standing : covered.through, standing, facts);
      yield* entries.plan(program, id, placements ?? [], facts, standing);
      yield* program.write(
        'contextReading' in columns && columns.contextReading !== undefined
          ? bindQuery(stamped.reading, { id, reading: columns.contextReading, updatedAt: at })
          : bindQuery(stamped.touched, { id, updatedAt: at }),
        1,
      );
    }),
  };
});
