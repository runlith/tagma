import { Effect } from 'effect';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { SessionNames } from '../contract/service/orientation.js';
import type { JournalSession } from '../contract/wire/journal.js';
import type { SessionRow } from '../../platform/contract/service/writers.js';
import type { WriterSession } from '../contract/wire/operations/history.js';

export const writerSession = (row: SessionRow): WriterSession => ({
  id: row.id,
  harness: row.harness,
  key: row.key,
  thread: row.harness === NATIVE_HARNESS ? row.key : null,
  createdAt: row.createdAt.toISOString(),
});

type Writer = { readonly id: number; readonly harness: string; readonly key: string };

export const journalSessions = (
  names: SessionNames['Service'],
  projectId: number,
  writers: readonly Writer[],
): Effect.Effect<JournalSession[], StoreFailure> =>
  Effect.map(
    names.of(
      projectId,
      writers.flatMap((row) => (row.harness === NATIVE_HARNESS ? [row.key] : [])),
    ),
    (named) =>
      writers.map((row) => {
        const thread = row.harness === NATIVE_HARNESS ? named.get(row.key) : undefined;
        return { id: row.id, harness: row.harness, key: row.key, title: thread?.title ?? null, name: thread?.name ?? null };
      }),
  );
