import { Effect } from 'effect';
import { readInboxItem } from '@runlith/agent/thread/persisted';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { trusted, type StoredFailure } from '../../platform/store/crossing.js';
import type { HarnessExecutionRef } from '../contract/wire/harness/observation.js';
import { threadInbox } from './tables.js';

export type InputAcceptance = 'confirmed' | 'unconfirmed' | 'handed' | 'queued';

const inputClaim = (runId: string, execution: HarnessExecutionRef | null): string =>
  JSON.stringify([runId, 'input', execution?.execution ?? null, execution?.incarnation ?? null]);

export const inputClaimOf = (claim: string | null): { runId: string; execution: HarnessExecutionRef | null } | null => {
  if (claim === null) return null;
  try {
    const value: unknown = JSON.parse(claim);
    if (!Array.isArray(value) || value.length !== 4 || typeof value[0] !== 'string' || value[1] !== 'input') return null;
    if (value[2] === null && value[3] === null) return { runId: value[0], execution: null };
    return typeof value[2] === 'string' && Number.isSafeInteger(value[3]) && value[3] >= 0
      ? { runId: value[0], execution: { execution: value[2], incarnation: value[3] } }
      : null;
  } catch {
    return null;
  }
};

const claimRun = (claim: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(claim);
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null;
  } catch {
    return null;
  }
};

export const confirmedClaim = (claim: string): boolean => claim === JSON.stringify([claimRun(claim), 'input-confirmed']);

const claimedBy = (db: StoreDb<'machine'>, threadId: string, ids: readonly string[], runId: string, unit: Unit<'machine'>) =>
  Effect.map(
    unit.run(
      db
        .select({ id: threadInbox.id, claim: threadInbox.claimId, kind: threadInbox.kind })
        .from(threadInbox)
        .where(and(eq(threadInbox.threadId, threadId), inArray(threadInbox.id, [...ids]))),
    ),
    (rows) => rows.filter((row) => inputClaimOf(row.claim)?.runId === runId),
  );

const unclaimed = (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string | null,
  set: Partial<typeof threadInbox.$inferInsert>,
  unit: Unit<'machine'>,
) =>
  Effect.map(
    unit.run(
      db
        .update(threadInbox)
        .set(set)
        .where(
          and(
            eq(threadInbox.threadId, threadId),
            inArray(threadInbox.id, [...ids]),
            runId === null
              ? eq(threadInbox.state, 'queued')
              : or(eq(threadInbox.state, 'queued'), and(eq(threadInbox.state, 'delivered'), eq(threadInbox.deliveredToRunId, runId))),
            isNull(threadInbox.claimId),
          ),
        )
        .returning({ id: threadInbox.id }),
    ),
    (rows) => rows.map((row) => row.id),
  );

export const reserveInputs = (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string,
  execution: HarnessExecutionRef | null,
  unit: Unit<'machine'>,
): Effect.Effect<readonly string[], StoredFailure> =>
  ids.length === 0
    ? Effect.succeed([])
    : unclaimed(db, threadId, ids, runId, { state: 'delivered', deliveredToRunId: runId, claimId: inputClaim(runId, execution) }, unit);

export const claimInputs = (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string,
  execution: HarnessExecutionRef | null,
  unit: Unit<'machine'>,
): Effect.Effect<readonly string[], StoredFailure> =>
  ids.length === 0 ? Effect.succeed([]) : unclaimed(db, threadId, ids, runId, { claimId: inputClaim(runId, execution) }, unit);

export const bindInputs = (
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  execution: HarnessExecutionRef,
  unit: Unit<'machine'>,
): Effect.Effect<void, StoredFailure> =>
  Effect.asVoid(
    unit.run(
      db
        .update(threadInbox)
        .set({ claimId: inputClaim(runId, execution) })
        .where(
          and(eq(threadInbox.threadId, threadId), eq(threadInbox.claimId, inputClaim(runId, null)), eq(threadInbox.state, 'delivered')),
        ),
    ),
  );

export const confirmInputs = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  ids: readonly string[],
  settles: boolean,
  unit: Unit<'machine'>,
) {
  if (ids.length === 0) return;
  const taken = yield* claimedBy(db, threadId, ids, runId, unit);
  if (taken.length === 0) return;
  yield* unit.run(
    db
      .update(threadInbox)
      .set({ state: 'delivered', deliveredToRunId: runId, claimId: JSON.stringify([runId, 'input-confirmed']) })
      .where(
        inArray(
          threadInbox.id,
          taken.map((row) => row.id),
        ),
      ),
  );
  const words = settles ? taken.filter((row) => row.kind !== 'task').map((row) => row.id) : [];
  if (words.length > 0) yield* unit.run(db.update(threadInbox).set({ state: 'acknowledged' }).where(inArray(threadInbox.id, words)));
});

export const readInputs = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  ids: readonly string[],
  unit: Unit<'machine'>,
) {
  if (ids.length === 0) return;
  const standing = yield* unit.run(
    db
      .select({ id: threadInbox.id, kind: threadInbox.kind })
      .from(threadInbox)
      .where(and(eq(threadInbox.threadId, threadId), inArray(threadInbox.id, [...ids]), ne(threadInbox.state, 'acknowledged'))),
  );
  if (standing.length === 0) return;
  yield* unit.run(
    db
      .update(threadInbox)
      .set({ state: 'delivered', deliveredToRunId: runId, claimId: JSON.stringify([runId, 'input-confirmed']) })
      .where(
        inArray(
          threadInbox.id,
          standing.map((row) => row.id),
        ),
      ),
  );
  const words = standing.filter((row) => row.kind !== 'task').map((row) => row.id);
  if (words.length > 0) yield* unit.run(db.update(threadInbox).set({ state: 'acknowledged' }).where(inArray(threadInbox.id, words)));
});

export const handInputs = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string,
  unit: Unit<'machine'>,
) {
  if (ids.length === 0) return;
  const standing = yield* unit.run(
    db
      .select({ id: threadInbox.id, claim: threadInbox.claimId })
      .from(threadInbox)
      .where(and(eq(threadInbox.threadId, threadId), inArray(threadInbox.id, [...ids]), ne(threadInbox.state, 'acknowledged'))),
  );
  for (const row of standing) {
    yield* unit.run(
      db
        .update(threadInbox)
        .set({
          state: 'delivered',
          deliveredToRunId: runId,
          claimId: inputClaimOf(row.claim)?.runId === runId ? row.claim : inputClaim(runId, null),
        })
        .where(eq(threadInbox.id, row.id)),
    );
  }
});

export const returnInputs = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string,
  unit: Unit<'machine'>,
) {
  if (ids.length === 0) return;
  const untaken = (yield* claimedBy(db, threadId, ids, runId, unit)).map((row) => row.id);
  if (untaken.length > 0)
    yield* unit.run(
      db.update(threadInbox).set({ state: 'queued', deliveredToRunId: null, claimId: null }).where(inArray(threadInbox.id, untaken)),
    );
});

export const withdrawInputs = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  ids: readonly string[],
  runId: string,
  unit: Unit<'machine'>,
) {
  if (ids.length === 0) return;
  const held = (yield* claimedBy(db, threadId, ids, runId, unit)).map((row) => row.id);
  if (held.length > 0)
    yield* unit.run(
      db
        .update(threadInbox)
        .set({ state: 'acknowledged', claimId: null })
        .where(and(inArray(threadInbox.id, held), eq(threadInbox.state, 'queued'))),
    );
});

export const releaseInputs = (
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  held: readonly string[],
  unit: Unit<'machine'>,
): Effect.Effect<readonly string[], StoredFailure> =>
  Effect.map(
    unit.run(
      db
        .update(threadInbox)
        .set({ claimId: null })
        .where(
          and(
            eq(threadInbox.threadId, threadId),
            eq(threadInbox.state, 'queued'),
            sql`json_array_length(${threadInbox.claimId}) = 4 AND json_extract(${threadInbox.claimId}, '$[0]') = ${runId} AND json_extract(${threadInbox.claimId}, '$[1]') = 'input'`,
            ...(held.length === 0 ? [] : [notInArray(threadInbox.id, [...held])]),
          ),
        )
        .returning({ id: threadInbox.id }),
    ),
    (rows) => rows.map((row) => row.id),
  );

export const takeBackInput = (
  db: StoreDb<'machine'>,
  threadId: string,
  id: string,
  unit: Unit<'machine'>,
): Effect.Effect<boolean, StoredFailure> =>
  Effect.map(unclaimed(db, threadId, [id], null, { state: 'acknowledged' }, unit), (taken) => taken.length > 0);

export const pendingInputs = (
  kinds: ThreadEntryReader,
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  unit: Unit<'machine'>,
): Effect.Effect<readonly ThreadInboxItem[], StoredFailure> =>
  Effect.flatMap(
    unit.run(
      db
        .select()
        .from(threadInbox)
        .where(
          and(
            eq(threadInbox.threadId, threadId),
            eq(threadInbox.deliveredToRunId, runId),
            eq(threadInbox.state, 'delivered'),
            isNotNull(threadInbox.claimId),
          ),
        ),
    ),
    (rows) =>
      trusted('inputPending', () => rows.filter((row) => inputClaimOf(row.claimId) !== null).map((row) => readInboxItem(kinds, row))),
  );

export const handedInputs = (
  kinds: ThreadEntryReader,
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  unit: Unit<'machine'>,
): Effect.Effect<readonly ThreadInboxItem[], StoredFailure> =>
  Effect.flatMap(
    unit.run(
      db
        .select()
        .from(threadInbox)
        .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.state, 'queued'), isNotNull(threadInbox.claimId)))
        .orderBy(asc(threadInbox.occurredAt), asc(threadInbox.seq)),
    ),
    (rows) =>
      trusted('inputHanded', () =>
        rows.filter((row) => inputClaimOf(row.claimId)?.runId === runId).map((row) => readInboxItem(kinds, row)),
      ),
  );

export const acknowledgeInputs = (
  db: StoreDb<'machine'>,
  ids: readonly string[],
  runId: string,
  unit: Unit<'machine'>,
): Effect.Effect<void, StoredFailure> =>
  ids.length === 0
    ? Effect.void
    : Effect.asVoid(
        unit.run(
          db
            .update(threadInbox)
            .set({ state: 'acknowledged' })
            .where(
              and(
                inArray(threadInbox.id, [...ids]),
                eq(threadInbox.deliveredToRunId, runId),
                eq(threadInbox.state, 'delivered'),
                sql`json_array_length(${threadInbox.claimId}) = 2 AND json_extract(${threadInbox.claimId}, '$[1]') = 'input-confirmed'`,
              ),
            ),
        ),
      );

export const acceptanceOf = (db: StoreDb<'machine'>, id: string, unit: Unit<'machine'>): Effect.Effect<InputAcceptance, StoredFailure> =>
  Effect.map(
    unit.run(db.select({ state: threadInbox.state, claim: threadInbox.claimId }).from(threadInbox).where(eq(threadInbox.id, id)).get()),
    (row) => {
      if (row === undefined || row.state === 'queued') return 'queued';
      if (row.claim !== null && confirmedClaim(row.claim)) return 'confirmed';
      return inputClaimOf(row.claim) === null ? 'handed' : 'unconfirmed';
    },
  );
