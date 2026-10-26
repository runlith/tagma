import { Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { chunk } from '@runlith/utils/collection';
import { rowsPerStatement } from '../platform/store/binds.js';
import type { MachineStore, StoreFailure } from '../platform/contract/service/store.js';
import { recordFacts } from './facts.js';

export type SessionName = { readonly title: string; readonly name: string | null; readonly ended: boolean };

export const sessionNames = Effect.fn('threadRecord.sessionNames')(function* (
  machine: MachineStore['Service'],
  projectId: number,
  threadIds: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, SessionName>, StoreFailure> {
  if (threadIds.length === 0) return new Map();
  const names = new Map<string, SessionName>();
  for (const ids of chunk([...new Set(threadIds)], rowsPerStatement(1) - 1)) {
    const rows = yield* machine.db
      .select({ threadId: recordFacts.id, title: recordFacts.title, name: recordFacts.name, archivedAt: recordFacts.archivedAt })
      .from(recordFacts)
      .where(and(eq(recordFacts.projectId, projectId), inArray(recordFacts.id, ids)));
    for (const row of rows) names.set(row.threadId, { title: row.title, name: row.name, ended: row.archivedAt !== null });
  }
  return names;
});
