import { Effect } from 'effect';
import { and, between, eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { conversationWrites, threadBase, threadEvent } from '../store/journal.js';
import { threadEntry } from '../store/kernel.js';
import { armsOf, type BaseLayer, layersOf } from './base.js';
import { conversationCopied } from './conversationIndex.js';
import { foldedBody } from './foldedFacts.js';

const ORDS = 64;
const POSITIONS = 64;
const PORTION_MS = 25;

const INHERITING = writes('thread.inherit', [threadEntry, threadEvent, threadBase], conversationWrites);

const standing = (db: MachineStore['Service']['db'], unit: WriteUnit<'machine'>, threadId: string, depth: number) =>
  Effect.map(layersOf(db, unit, threadId), (layers) => ({ layers, layer: layers.find((one) => one.depth === depth) }));

const step = Effect.fnUntraced(function* (db: MachineStore['Service']['db'], unit: WriteUnit<'machine'>, threadId: string, depth: number) {
  const { layers, layer } = yield* standing(db, unit, threadId, depth);
  if (layer === undefined) return false;
  const where = and(eq(threadBase.threadId, threadId), eq(threadBase.depth, depth));
  if (layer.lowOrd <= layer.highOrd) {
    const arm = armsOf(threadId, layers).find((one) => one.layer?.depth === depth)!;
    const last = Math.min(layer.highOrd, layer.lowOrd + ORDS - 1);
    yield* unit.run(
      db.run(sql`insert into ${threadEntry} (thread_id, ord, entry_id, run_id, type, entry)
        select ${threadId}, ${threadEntry.ord}, ${threadEntry.entryId}, ${threadEntry.runId}, ${threadEntry.type}, ${threadEntry.entry}
          from ${threadEntry} where ${and(arm.where, between(threadEntry.ord, layer.lowOrd, last))}
        on conflict do nothing`),
    );
    yield* unit.run(
      db
        .update(threadBase)
        .set(last >= layer.highOrd ? { lowOrd: 1, highOrd: 0, unfiled: true } : { lowOrd: last + 1, unfiled: true })
        .where(where),
    );
    return true;
  }
  if (layer.afterPosition >= layer.throughPosition) return false;
  const to = Math.min(layer.throughPosition, layer.afterPosition + POSITIONS);
  yield* unit.run(
    db.run(sql`insert into ${threadEvent} (thread_id, position, id, kind, payload)
      select ${threadId}, ${threadEvent.position}, ${`${threadId}:`} || ${threadEvent.position}, ${threadEvent.kind},
        case when ${threadEntry.entry} is null
            or exists (select 1 from ${threadEntry} as own where own.thread_id = ${threadId} and own.entry_id = ${threadEntry.entryId})
          then ${threadEvent.payload}
          else json_set(json_remove(${threadEvent.payload}, '$.bodyInFold'), '$.entry', json(${threadEntry.entry})) end
        from ${threadEvent} left join ${threadEntry} on ${foldedBody}
       where ${threadEvent.threadId} = ${layer.sourceId}
         and ${threadEvent.position} > ${layer.afterPosition} and ${threadEvent.position} <= ${to}
      on conflict do nothing`),
  );
  yield* conversationCopied(db, unit, layer, layer.afterPosition, to);
  yield* unit.run(db.update(threadBase).set({ afterPosition: to, unfiled: true }).where(where));
  return true;
});

export const inheritPrefix = Effect.fn('ThreadRollout.inherit')(function* (layer: BaseLayer, yielding: boolean) {
  yield* Effect.annotateCurrentSpan({ threadId: layer.threadId, sourceId: layer.sourceId });
  const store = yield* MachineStore;
  let longest = 0;
  while (true) {
    const portion = yield* store.transaction(INHERITING, (unit) =>
      Effect.gen(function* () {
        const started = performance.now();
        do {
          if (!(yield* step(store.db, unit, layer.threadId, layer.depth))) return { done: true, heldMs: performance.now() - started };
        } while (performance.now() - started < PORTION_MS);
        return { done: false, heldMs: performance.now() - started };
      }),
    );
    longest = Math.max(longest, portion.heldMs);
    if (portion.done) break;
    if (yielding) yield* Effect.sleep(Math.max(PORTION_MS, portion.heldMs));
  }
  yield* Effect.annotateCurrentSpan({ longestPortionMs: longest });
});

export const heardFromLayers = Effect.fn('ThreadRollout.inherit.heard')(function* (threadId: string, yielding: boolean) {
  const store = yield* MachineStore;
  const layers = yield* store.readOnly((db) => db.select().from(threadBase).where(eq(threadBase.threadId, threadId)));
  for (const layer of layers) {
    let from = layer.afterPosition;
    while (from < layer.throughPosition) {
      const to = Math.min(layer.throughPosition, from + POSITIONS);
      yield* store.transaction(writes('thread.inherit.heard', [], conversationWrites), (unit) =>
        conversationCopied(store.db, unit, layer, from, to),
      );
      from = to;
      if (yielding) yield* Effect.sleep(PORTION_MS);
    }
  }
});
