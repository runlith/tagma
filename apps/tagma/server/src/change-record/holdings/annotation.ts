import { Effect } from 'effect';
import { and, eq, exists, inArray } from 'drizzle-orm';
import { chunk, unique } from '@runlith/utils/collection';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { workspaceChange } from '../store/tables.js';
import type { Holding } from '../contract/wire/holdings.js';
import { holderKey } from '../../workspace/contract/wire/checkout.js';
import type { InputReaders, StoredRow } from './inputs.js';

export type Annotation = { readonly archived: boolean; readonly running: string | null; readonly name: string | null };

export type Annotations = ReadonlyMap<string, Annotation>;

export type RowMarks = readonly Pick<StoredRow, 'holder' | 'runId' | 'state'>[];

const THREADS_PER_STATEMENT = rowsPerStatement(1);

export const annotated = (holding: Holding, rows: RowMarks, threads: Annotations): Holding => {
  if (holding.verdict.verdict !== 'proven' || holding.verdict.hands.length === 0) return holding;
  return {
    ...holding,
    verdict: {
      ...holding.verdict,
      hands: holding.verdict.hands.map((hand) => {
        const key = holderKey(hand.holder);
        const thread = hand.holder.kind === 'thread' ? threads.get(hand.holder.thread) : undefined;
        const running = thread?.running ?? null;
        const writing = rows.some((row) => row.holder === key && (row.state === 'writing' || (running !== null && row.runId === running)));
        return { ...hand, writing, retired: thread?.archived ?? false };
      }),
    },
  };
};

export const annotationsAt = (readers: InputReaders, threads: readonly string[]): Effect.Effect<Annotations, StoreFailure> => {
  if (threads.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    Effect.forEach(chunk(unique(threads), THREADS_PER_STATEMENT), (ids) =>
      readers.units.read((unit) =>
        unit.run(
          readers.store.db
            .select({
              id: threadRecord.id,
              archivedAt: threadRecord.archivedAt,
              running: threadRecord.runningRunId,
              name: threadRecord.name,
            })
            .from(threadRecord)
            .where(
              and(
                inArray(threadRecord.id, ids),
                exists(
                  readers.store.db
                    .select({ id: workspaceChange.id })
                    .from(workspaceChange)
                    .where(and(eq(workspaceChange.holder, threadRecord.id), eq(workspaceChange.holderProjectId, threadRecord.projectId))),
                ),
              ),
            ),
        ),
      ),
    ),
    (groups) =>
      new Map(groups.flat().map((row) => [row.id, { archived: row.archivedAt !== null, running: row.running, name: row.name }] as const)),
  );
};
