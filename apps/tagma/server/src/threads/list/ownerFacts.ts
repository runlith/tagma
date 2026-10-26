import { inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { recordFacts } from '../../thread-record/facts.js';
import { type LoadOwnerFacts, type OwnerFacts, OwnerFactsUnread } from '../../executions/contract/service/owners.js';

export const ownerFacts = (db: StoreDb<'machine'>): LoadOwnerFacts['Service'] => ({
  read: (threads) =>
    threads.length === 0
      ? Effect.succeed(new Map())
      : db
          .select({
            id: recordFacts.id,
            name: recordFacts.name,
            title: recordFacts.title,
            archivedAt: recordFacts.archivedAt,
          })
          .from(recordFacts)
          .where(inArray(recordFacts.id, threads as ThreadId[]))
          .pipe(
            Effect.map((rows) => {
              const facts = new Map<string, OwnerFacts>();
              for (const row of rows) {
                const title = row.name ?? row.title ?? undefined;
                facts.set(row.id, { title: title === undefined || title === '' ? undefined : title, archived: row.archivedAt !== null });
              }
              return facts;
            }),
            Effect.mapError(() => new OwnerFactsUnread({ reason: 'the thread register did not answer' })),
          ),
});
