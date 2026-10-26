import { and, desc, eq, inArray, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ENDINGS_LIST, threadEntry, threadRun } from '../store/kernel.js';
import { threadRolloutCursor } from '../store/journal.js';
import { keepWarmRun } from '../store/tables.js';
import { entryField, entryFieldType } from '../store/fields.js';
import { SAID_LINE_CHARS } from '../contract/wire/list.js';

const BLANK = sql.raw(`' ' || char(9) || char(10) || char(13)`);

const ENTRY = sql.raw('e.entry');

const spoken = (threadId: SQL, runId: SQL): SQL => sql`e.thread_id = ${threadId}
     and e.run_id = ${runId}
     and e.type = 'message'
     and case when json_valid(e.entry) then
           ${entryField(ENTRY, 'role')} = 'assistant'
           and ${entryFieldType(ENTRY, 'text')} = 'text'
           and trim(${entryField(ENTRY, 'text')}, ${BLANK}) <> ''
         else 1 end`;

const assistantText = (threadId: SQL, runId: SQL, after: SQL | null, order: 'asc' | 'desc'): SQL => sql`(
  select case when json_valid(e.entry) then ltrim(${entryField(ENTRY, 'text')}, ${BLANK}) end
    from ${threadEntry} e
   where ${spoken(threadId, runId)}
     ${after === null ? sql`` : sql`and e.ord > ${after}`}
   order by e.ord ${sql.raw(order)}
   limit 1
)`;

const newestTextOrd = (threadId: SQL, runId: SQL): SQL => sql`(
  select e.ord from ${threadEntry} e where ${spoken(threadId, runId)} order by e.ord desc limit 1
)`;

const toolBefore = (threadId: SQL, runId: SQL, before: SQL): SQL => sql`coalesce((
  select x.ord from ${threadEntry} x
   where x.thread_id = ${threadId} and x.run_id = ${runId} and x.type = 'tool' and x.ord < ${before}
   order by x.ord desc
   limit 1
), -9e18)`;

const firstLine = (text: SQL): SQL => sql`coalesce((
  select substr(said.body, 1, min(instr(said.body || char(10), char(10)) - 1, ${SAID_LINE_CHARS + 1}))
    from (select ${text} as body) said
), '')`;

const THREAD = sql.raw('"thread_run"."thread_id"');
const RUN = sql.raw('"thread_run"."id"');

export const finalWords = (threadId: string, runId: string): SQL<string | null> => {
  const thread = sql`${threadId}`;
  const run = sql`${runId}`;
  return sql<string | null>`(
  select group_concat(words.text, char(10)) from (
    select case when json_valid(e.entry) then trim(${entryField(ENTRY, 'text')}, ${BLANK}) end as text
      from ${threadEntry} e
     where ${spoken(thread, run)}
       and e.ord > ${toolBefore(thread, run, newestTextOrd(thread, run))}
     order by e.ord asc
  ) words
)`;
};

export const SAID_ENTRY_TYPES: ReadonlySet<string> = new Set(['message', 'tool']);

export const movesSaid = (entry: ThreadTranscriptEntry, appended: boolean): boolean => {
  if (!appended) return SAID_ENTRY_TYPES.has(entry.type);
  const spoken = entry as { readonly type: string; readonly role?: unknown; readonly text?: unknown };
  return spoken.type === 'message' && spoken.role === 'assistant' && typeof spoken.text === 'string' && /[^ \t\n\r]/.test(spoken.text);
};

const said = (db: StoreDb<'machine'>, threadId: string, runs: SQL) =>
  db
    .update(threadRun)
    .set({
      saidLive: sql`${firstLine(assistantText(THREAD, RUN, null, 'desc'))}`,
      saidFinal: sql`${firstLine(assistantText(THREAD, RUN, toolBefore(THREAD, RUN, newestTextOrd(THREAD, RUN)), 'asc'))}`,
    })
    .where(and(eq(threadRun.threadId, threadId), runs));

export const saidOfRuns = (db: StoreDb<'machine'>, threadId: string, runIds: readonly string[]) =>
  said(db, threadId, inArray(threadRun.id, [...runIds]));

const SHOWN = sql.raw('shown.id');

const shownRun = (threadId: SQLWrapper | string, run: SQL): SQL => sql`(${run}.status = 'running' or ${run}.id = (
      select ${SHOWN} from ${threadRun} shown
       where shown.thread_id = ${threadId}
         and shown.status in ${ENDINGS_LIST}
         and not ${keepWarmRun(SHOWN)}
       order by ${SHOWN} desc
       limit 1
    ))`;

export const saidOfShown = (db: StoreDb<'machine'>, threadId: string) => said(db, threadId, shownRun(threadId, sql.raw('"thread_run"')));

export const unsaidThreads = (db: StoreDb<'machine'>, threadId?: string) =>
  db
    .select({ id: threadRecord.id })
    .from(threadRecord)
    .where(
      and(
        threadId === undefined ? undefined : eq(threadRecord.id, threadId),
        isNull(threadRecord.archivedAt),
        sql`not exists (select 1 from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadRecord.id} and ${threadRolloutCursor.restedAt} is not null)`,
        sql`exists (select 1 from ${threadRun} unsaid
          where unsaid.thread_id = ${threadRecord.id}
            and unsaid.said_final is null
            and ${shownRun(threadRecord.id, sql.raw('unsaid'))})`,
      ),
    )
    .orderBy(desc(threadRecord.readerOrderAt));
