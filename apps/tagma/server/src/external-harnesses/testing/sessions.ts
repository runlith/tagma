import { eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { KernelSeat } from '../../threads/contract/wire/harness/seat.js';
import { recordFacts } from '../../thread-record/facts.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { sessionRows } from '../../threads/store/harnessFacet.js';
import { activeOf, externalSession, sessionValues } from '../../threads/store/harnessFacet.js';
import { thread } from '../../threads/store/kernel.js';
import { seatColumns } from '../../threads/store/seat.js';
import { terminalKernel } from '../birth/seat.js';
import { builtinHarness } from './builtin.js';

export const sessionFor = (
  db: StoreDb<'machine'>,
  id: string,
  facet: ExternalSession | null,
  kernel?: KernelSeat,
): Effect.Effect<void, StoreFailure> =>
  facet === null
    ? Effect.asVoid(db.delete(externalSession).where(eq(externalSession.id, id)))
    : Effect.gen(function* () {
        yield* db.update(threadRecord).set({ harness: facet.name }).where(eq(threadRecord.id, id));
        const values = { ...sessionValues(facet), activeAt: activeOf(facet) };
        yield* db
          .insert(externalSession)
          .values({ id, ...values })
          .onConflictDoUpdate({ target: externalSession.id, set: values });
        if (kernel === undefined) {
          const seat = seatColumns(terminalKernel(builtinHarness(facet.name), undefined, facet.plain === true, {}));
          yield* db
            .insert(thread)
            .values({ id, cacheGroup: id, ...seat })
            .onConflictDoUpdate({ target: thread.id, set: seat });
        } else {
          yield* db
            .insert(thread)
            .values({ id, cacheGroup: id, ...seatColumns(kernel) })
            .onConflictDoUpdate({ target: thread.id, set: seatColumns(kernel) });
        }
        yield* db.run(sql`insert into thread_log (thread_id) values (${id}) on conflict do nothing`);
      });

export const sessionOfThread = (db: StoreDb<'machine'>, id: string): Effect.Effect<ExternalSession | null, StoreFailure> =>
  Effect.map(db.select({ facet: sessionRows.facet }).from(sessionRows).where(eq(sessionRows.id, id)).get(), (row) => row?.facet ?? null);

export const keyedSessions = (db: StoreDb<'machine'>, key: string) =>
  db
    .select({ id: sessionRows.id, projectId: recordFacts.projectId, facet: sessionRows.facet })
    .from(sessionRows)
    .innerJoin(recordFacts, eq(recordFacts.id, sessionRows.id))
    .where(sql`json_extract(${sessionRows.facet}, '$.sessionKey') = ${key}`);
