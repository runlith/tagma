import { and, desc, eq, inArray, isNull, lte, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { among } from '../../platform/store/rows.js';
import type { RecapStatus } from '../../thread-record/contract/wire/recap.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { isReaderWordsItem } from '@runlith/agent/thread/inboxItems';
import { threadInbox } from '../store/tables.js';
import { threadConversation, threadMessage, threadMessageGap } from '../store/conversation.js';

export type CoveredMessage = {
  readonly entryId: string;
  readonly runId: string | null;
  readonly appeared: number;
  readonly position: number;
};

export const recapStatusOf = (threadId: SQLWrapper, recap: SQLWrapper): SQL<RecapStatus | null> =>
  sql<RecapStatus | null>`case
    when ${recap} is null then null
    when json_extract(${recap}, '$.voided') then 'void'
    when exists (select 1 from ${threadMessage}
      where ${threadMessage.threadId} = ${threadId}
        and ${threadMessage.appeared} > json_extract(${recap}, '$.basis.position')
        and ${threadMessage.rewound} is null) then 'stale'
    else 'current'
  end`;

export const statusesOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  ids: readonly string[],
): Effect.Effect<ReadonlyMap<string, RecapStatus>, StoreFailure> =>
  ids.length === 0
    ? Effect.succeed(new Map())
    : Effect.map(
        unit.run(
          db
            .select({ id: threadRecord.id, status: recapStatusOf(threadRecord.id, threadRecord.recap) })
            .from(threadRecord)
            .where(inArray(threadRecord.id, among(ids))),
        ),
        (rows) => new Map(rows.flatMap((row) => (row.status === null ? [] : [[row.id, row.status] as const]))),
      );

export const latestSaid = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
): Effect.Effect<CoveredMessage | undefined, StoreFailure> =>
  unit.run(
    db
      .select({
        entryId: threadMessage.entryId,
        runId: threadMessage.runId,
        appeared: threadMessage.appeared,
        position: threadMessage.position,
      })
      .from(threadMessage)
      .where(and(eq(threadMessage.threadId, threadId), isNull(threadMessage.rewound)))
      .orderBy(desc(threadMessage.appeared))
      .limit(1)
      .get(),
  );

type InboxWords = Parameters<typeof isReaderWordsItem>[0];

const readerWords = (rows: readonly { readonly kind: string; readonly body: unknown }[]): boolean =>
  rows.some((row) => isReaderWordsItem(row as unknown as InboxWords));

export const readerItem = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  id: string,
): Effect.Effect<boolean, StoreFailure> =>
  Effect.map(
    unit.run(
      db
        .select({ kind: threadInbox.kind, body: threadInbox.body })
        .from(threadInbox)
        .where(and(eq(threadInbox.id, id), eq(threadInbox.threadId, threadId))),
    ),
    readerWords,
  );

export const readerWaiting = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadId: string): Effect.Effect<boolean, StoreFailure> =>
  Effect.map(
    unit.run(
      db
        .select({ kind: threadInbox.kind, body: threadInbox.body })
        .from(threadInbox)
        .where(and(eq(threadInbox.threadId, threadId), eq(threadInbox.state, 'queued'))),
    ),
    readerWords,
  );

export const coveredAmong = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  entryIds: readonly string[],
  covered: number,
): Effect.Effect<boolean, StoreFailure> =>
  entryIds.length === 0
    ? Effect.succeed(false)
    : Effect.map(
        unit.run(
          db
            .select({ key: threadMessage.key })
            .from(threadMessage)
            .where(
              and(
                eq(threadMessage.threadId, threadId),
                inArray(threadMessage.entryId, [...entryIds]),
                lte(threadMessage.appeared, covered),
              ),
            )
            .limit(1)
            .get(),
        ),
        (row) => row !== undefined,
      );

export const answeredTwice = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadId: string): Effect.Effect<boolean, StoreFailure> =>
  Effect.map(
    unit.run(
      db
        .select({ key: threadMessage.key })
        .from(threadMessage)
        .where(and(eq(threadMessage.threadId, threadId), eq(threadMessage.role, 'agent'), isNull(threadMessage.rewound)))
        .limit(2),
    ),
    (rows) => rows.length === 2,
  );

export const indexedThrough = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
  head: number,
): Effect.Effect<boolean, StoreFailure> =>
  Effect.map(
    unit.run(
      db
        .select({
          whole: sql<number>`${threadConversation.through} >= ${head} and not ${threadConversation.unreadable}
            and not exists (select 1 from ${threadMessageGap} where ${threadMessageGap.threadId} = ${threadConversation.threadId})`,
        })
        .from(threadConversation)
        .where(eq(threadConversation.threadId, threadId))
        .get(),
    ),
    (row) => row?.whole === 1,
  );
