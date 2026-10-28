import { Clock, Effect } from 'effect';
import { and, eq, inArray, max } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { writes } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Tags } from '../contract/service/vocabulary.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { block, event } from '../store/tables.js';
import { ELSEWHERE, elsewhere } from '../tree/sessions.js';
import { sessionToken } from '../../platform/contract/wire/session.js';

const stepping = writes('Tree.step.holdersProven', [block, session]);

export const holdersProven = Effect.fn('GraphStep.holdersProven')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const table = yield* (yield* Tags).of(project.id);
  const rows = yield* db
    .select({ id: block.id, tags: block.tags, fields: block.fields })
    .from(block)
    .where(eq(block.projectId, project.id));
  const held = rows.filter((row) => table.holderOf(row) !== null);
  if (held.length === 0) return;
  const claimer = new Map<number | null, number | null>();
  for (const page of pagesOf(held, 1)) {
    const latest = db
      .select({ id: max(event.id) })
      .from(event)
      .where(
        and(
          eq(event.op, 'claim'),
          inArray(
            event.blockId,
            page.map((row) => row.id),
          ),
        ),
      )
      .groupBy(event.blockId);
    for (const row of yield* db
      .select({ blockId: event.blockId, sessionId: event.sessionId })
      .from(event)
      .where(inArray(event.id, latest))) {
      claimer.set(row.blockId, row.sessionId);
    }
  }
  const foreign = new Set<number>();
  const identity = new Map<number, string>();
  const writers = [...held.map((row) => table.holderOf(row)!), ...[...claimer.values()].filter((id): id is number => id !== null)];
  for (const page of pagesOf([...new Set(writers)], 1)) {
    for (const row of yield* db
      .select({ id: session.id, harness: session.harness, key: session.key })
      .from(session)
      .where(inArray(session.id, page))) {
      if (row.harness === ELSEWHERE) foreign.add(row.id);
      identity.set(row.id, sessionToken(row));
    }
  }
  const unproven = held.filter((row) => {
    const holder = table.holderOf(row)!;
    const claimedBy = claimer.get(row.id);
    const same = claimedBy != null && identity.has(holder) && identity.get(holder) === identity.get(claimedBy);
    return claimedBy !== holder && !same && !foreign.has(holder);
  });
  if (unproven.length === 0) return;
  yield* store.transaction(stepping, (unit) =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const row of unproven) {
        const field = table.bindingTag(row, HOLDER)?.contracts?.[HOLDER]?.slots[HOLDER_SLOT];
        if (field === undefined) continue;
        const fields = { ...row.fields, [field]: yield* elsewhere(unit, table.holderOf(row)!) };
        yield* db.update(block).set({ fields, updatedAt: now }).where(eq(block.id, row.id));
      }
    }),
  );
});
