import { createHash } from 'node:crypto';
import { Clock, Effect } from 'effect';
import { type SQL, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { project } from '../../projects/store/table.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { MESSAGE_FTS, threadConversation, threadMessage, threadMessageGap } from '../store/conversation.js';
import { threadBase } from '../store/journal.js';
import { threadEntry } from '../store/kernel.js';
import { type BaseLayer, layersOf } from './base.js';
import type {
  ConversationCoverage,
  ConversationHeld,
  ConversationHit,
  ConversationRole,
  ConversationTally,
  ConversationWindow,
} from '../contract/wire/conversation.js';
import { Conversations, type ConversationSearch } from '../contract/service/conversations.js';
import type { Reach } from '../../projects/contract/wire/reach.js';
import { EvidenceReads } from '../contract/service/evidence.js';
import { ThreadInputRefused, ThreadRefused, type HarnessFailure } from '../contract/service/failure.js';
import { snippetOf } from '@runlith/search-text/highlight';
import { BUCKET, keyable, matchExpression, nearQuery, projectionOf, SPELLING_SAMPLE, spellingsOf, termsOf } from '@runlith/search-text/fts';

const SNIPPET = 240;

//! A chunk is one FTS read: big enough that a page rarely needs a second, small enough that its rows stay a few tens of kilobytes.
const CHUNK = 256;
//! The matches one page may look past, its own scope's or not, before it answers short with a cursor: eight chunks.
const PAGE_MATCHES = CHUNK * 8;
//! The total counts for as long as a noticeable delay allows, so its cost is bounded by this machine's speed and not by the corpus.
const TALLY_BUDGET_MS = 50;
const TALLY_CHUNK = 1024;
//! A window answers whole messages, so its reach each side stays a page's worth.
const AROUND = 25;

type Seen = {
  readonly key: string;
  readonly thread_id: string;
  readonly entry_id: string;
  readonly position: number;
  readonly run_id: string | null;
  readonly role: ConversationRole;
  readonly occurred_at: number;
  readonly project_id: number | null;
  readonly project_name: string | null;
  readonly title: string;
  readonly name: string | null;
  readonly parent_id: string | null;
  readonly archived: number;
  readonly text?: string;
};

type Said = { readonly key: string; readonly text: string };

type Spoken = {
  readonly entry_id: string;
  readonly position: number;
  readonly run_id: string | null;
  readonly role: ConversationRole;
  readonly occurred_at: number;
  readonly text: string;
};

const fts = sql.raw(MESSAGE_FTS);

const instant = (ms: number): string => new Date(ms).toISOString();

const keyOf = (key: string): SQL => sql`cast(${key} as integer)`;

const spoken = (): SQL =>
  sql`select ${threadMessage.entryId} as entry_id, ${threadMessage.position} as position, ${threadMessage.runId} as run_id,
      ${threadMessage.role} as role, ${threadMessage.occurredAt} as occurred_at, ${threadMessage.text} as text from ${threadMessage}`;

const reader = sql.raw('reader.value');

//! A match is heard by its own thread and by every branch whose prefix holds it, so a search over threads finds branches too.
const readers = sql`cross join json_each(json_insert(coalesce((select json_group_array(b.thread_id) from ${threadBase} as b
    where b.source_id = ${threadMessage.threadId}
      and ${threadMessage.position} > b.after_position and ${threadMessage.position} <= b.through_position
      and not exists (select 1 from ${threadMessage} as own where own.thread_id = b.thread_id and own.entry_id = ${threadMessage.entryId})
      and not exists (select 1 from ${threadBase} as ub join ${threadMessage} as um on um.thread_id = ub.source_id
        where ub.thread_id = b.thread_id and ub.depth > b.depth and um.entry_id = ${threadMessage.entryId}
          and um.position > ub.after_position and um.position <= ub.through_position)
      and (exists (select 1 from ${threadEntry} as copied where copied.thread_id = b.thread_id and copied.entry_id = ${threadMessage.entryId})
        or exists (select 1 from ${threadEntry} as carried where carried.thread_id = b.source_id and carried.entry_id = ${threadMessage.entryId}
          and carried.ord between b.low_ord and b.high_ord
          and (carried.run_id is null or carried.run_id not in (select value from json_each(b.hidden)))))), '[]'),
    '$[#]', ${threadMessage.threadId})) as reader`;

const boundaryOf = (key: string, threadId: string, perThread: boolean): string => (perThread ? `${key}|${threadId}` : key);

const rangeOf = (request: ConversationSearch): ((boundary: string | null) => SQL) => {
  const since = request.since === undefined ? sql`` : sql` and ${fts}.rowid >= ${request.since} * ${BUCKET}`;
  const before = request.before === undefined ? sql`` : sql` and ${fts}.rowid < ${request.before} * ${BUCKET}`;
  return (boundary) => {
    if (boundary === null) return sql`${since}${before}`;
    const [key = boundary, after] = boundary.split('|');
    const past =
      after === undefined
        ? sql` and ${fts}.rowid < ${keyOf(key)}`
        : sql` and ${fts}.rowid <= ${keyOf(key)} and (${fts}.rowid < ${keyOf(key)} or ${reader} < ${after})`;
    return sql`${since}${before}${past}`;
  };
};

const scopeCondition = (scope: Reach): SQL =>
  scope.kind === 'all'
    ? scope.removed.length === 0
      ? sql`1`
      : sql`(${threadRecord.projectId} is null or ${threadRecord.projectId} not in (${sql.join(
          scope.removed.map((id) => sql`${id}`),
          sql`, `,
        )}))`
    : scope.ids.length === 0
      ? sql`0`
      : sql`${threadRecord.projectId} in (${sql.join(
          scope.ids.map((id) => sql`${id}`),
          sql`, `,
        )})`;

const inherited = (threadId: string, layers: readonly BaseLayer[], at: number): SQL => {
  const layer = layers[at]!;
  const hidden =
    layer.hidden.length === 0
      ? sql``
      : sql` and (inherited.run_id is null or inherited.run_id not in (select value from json_each(${JSON.stringify(layer.hidden)})))`;
  const above = layers.slice(at + 1).map(
    (upper) => sql` and not exists (select 1 from ${threadMessage} as upper where upper.thread_id = ${upper.sourceId}
        and upper.entry_id = ${threadMessage.entryId} and upper.position > ${upper.afterPosition} and upper.position <= ${upper.throughPosition})`,
  );
  return sql`(${threadMessage.threadId} = ${layer.sourceId}
    and ${threadMessage.position} > ${layer.afterPosition} and ${threadMessage.position} <= ${layer.throughPosition}
    and not exists (select 1 from ${threadMessage} as own where own.thread_id = ${threadId} and own.entry_id = ${threadMessage.entryId})
    ${sql.join(above, sql``)}
    and (exists (select 1 from ${threadEntry} as copied where copied.thread_id = ${threadId} and copied.entry_id = ${threadMessage.entryId})
      or exists (select 1 from ${threadEntry} as inherited where inherited.thread_id = ${layer.sourceId}
        and inherited.entry_id = ${threadMessage.entryId} and inherited.ord between ${layer.lowOrd} and ${layer.highOrd}${hidden})))`;
};

const heardIn = (threadId: string, layers: readonly BaseLayer[]): SQL =>
  layers.length === 0
    ? sql`${threadMessage.threadId} = ${threadId}`
    : sql`(${threadMessage.threadId} = ${threadId} or ${sql.join(
        layers.map((_, at) => inherited(threadId, layers, at)),
        sql` or `,
      )})`;

const speaker = (request: ConversationSearch): SQL => (request.threadId === undefined ? reader : sql`${request.threadId}`);

const inside = (request: ConversationSearch, excluded: string | null, layers: readonly BaseLayer[]): SQL => {
  const own = request.threadId === undefined ? sql`` : sql` and ${heardIn(request.threadId, layers)}`;
  return sql`${scopeCondition(request.scope)}${own}${excluded === null ? sql`` : sql` and ${speaker(request)} != ${excluded}`}`;
};

const heardFrom = (request: ConversationSearch): SQL =>
  sql`from ${fts}
      cross join ${threadMessage} on ${threadMessage.key} = ${fts}.rowid
      ${request.threadId === undefined ? readers : sql``}
      cross join ${threadRecord} on ${threadRecord.id} = ${speaker(request)}`;

const ordered = (request: ConversationSearch): SQL =>
  request.threadId === undefined ? sql`order by ${fts}.rowid desc, ${reader} desc` : sql`order by ${fts}.rowid desc`;

const chunkOf = (
  match: string,
  request: ConversationSearch,
  range: SQL,
  excluded: string | null,
  text: SQL | null,
  layers: readonly BaseLayer[],
): SQL =>
  sql`select cast(${fts}.rowid as text) as key, ${speaker(request)} as thread_id, ${threadMessage.entryId} as entry_id,
        ${threadMessage.position} as position, ${threadMessage.runId} as run_id, ${threadMessage.role} as role,
        ${threadMessage.occurredAt} as occurred_at, ${threadRecord.projectId} as project_id, ${project.name} as project_name,
        ${threadRecord.title} as title, ${threadRecord.name} as name, ${threadRecord.parentId} as parent_id,
        ${threadRecord.archivedAt} is not null as archived${text === null ? sql`` : sql`, ${text} as text`}
      ${heardFrom(request)}
      left join ${project} on ${project.id} = ${threadRecord.projectId}
      where ${fts}.text match ${match}${range} and ${inside(request, excluded, layers)}
      ${ordered(request)} limit ${CHUNK}`;

export const makeConversationReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const reads = yield* EvidenceReads;

  const textsOf = (keys: readonly string[]): Effect.Effect<ReadonlyMap<string, string>, HarnessFailure> =>
    keys.length === 0
      ? Effect.succeed(new Map())
      : Effect.map(
          units.read((unit) =>
            unit.run(
              db.all<Said>(sql`select cast(${threadMessage.key} as text) as key, ${threadMessage.text} as text from ${threadMessage}
            where ${threadMessage.key} in (${sql.join(keys.map(keyOf), sql`, `)})`),
            ),
          ),
          (rows) => new Map(rows.map((row) => [row.key, row.text])),
        );

  const tallyOf = Effect.fnUntraced(function* (
    match: string,
    request: ConversationSearch,
    range: (boundary: string | null) => SQL,
    excluded: string | null,
    layers: readonly BaseLayer[],
  ) {
    const started = yield* Clock.currentTimeMillis;
    const threads = new Set<string>();
    let messages = 0;
    let boundary: string | null = null;
    while (true) {
      const counted = yield* units.read((unit) =>
        unit.run(
          db.all<{
            readonly key: string;
            readonly thread_id: string;
          }>(sql`select cast(${fts}.rowid as text) as key, ${speaker(request)} as thread_id
              ${heardFrom(request)}
              where ${fts}.text match ${match}${range(boundary)} and ${inside(request, excluded, layers)}
              ${ordered(request)} limit ${TALLY_CHUNK}`),
        ),
      );
      for (const row of counted) threads.add(row.thread_id);
      messages += counted.length;
      const found = request.threadId === undefined ? threads.size : messages;
      if (counted.length < TALLY_CHUNK) return { total: found } satisfies ConversationTally;
      if ((yield* Clock.currentTimeMillis) - started >= TALLY_BUDGET_MS)
        return { total: null, atLeast: found, cut: 'count-limit' as const } satisfies ConversationTally;
      const last = counted[counted.length - 1]!;
      boundary = boundaryOf(last.key, last.thread_id, request.threadId === undefined);
    }
  });

  const coverageOf = Effect.fnUntraced(function* (request: ConversationSearch, layers: readonly BaseLayer[]) {
    const read = request.threadId === undefined ? [] : [request.threadId, ...layers.map((layer) => layer.sourceId)];
    const one =
      read.length === 0
        ? sql``
        : sql` and ${threadRecord.id} in (${sql.join(
            read.map((id) => sql`${id}`),
            sql`, `,
          )})`;
    const [row] = yield* units.read((unit) =>
      unit.run(
        db.all<{ readonly unindexed: number }>(sql`select count(*) as unindexed from ${threadRecord}
            left join ${threadConversation} on ${threadConversation.threadId} = ${threadRecord.id}
            where ${scopeCondition(request.scope)}${one} and (${threadConversation.threadId} is null
              or ${threadConversation.through} < ${threadConversation.seen}
              or ${threadConversation.unreadable} = 1
              or exists (select 1 from ${threadMessageGap} where ${threadMessageGap.threadId} = ${threadRecord.id}))`),
      ),
    );
    const unindexed = row?.unindexed ?? 0;
    return { complete: unindexed === 0, unindexed } satisfies ConversationCoverage;
  });

  return Conversations.of({
    search: Effect.fn('Conversations.search')(function* (reader, request) {
      const terms = termsOf(request.query);
      if (terms.matched.length === 0) {
        return yield* new GateRefusal(
          'query-too-short',
          `"${request.query}" holds no word of three characters or more, and a shorter one is only checked among matches a longer one found.`,
          ['search a word of three characters or more, adding the short ones beside it'],
        );
      }
      for (const [field, ms] of [
        ['since', request.since],
        ['before', request.before],
      ] as const) {
        if (ms !== undefined && !keyable(ms)) {
          return yield* new GateRefusal('selection-shape', `\`${field}\` names an instant this index cannot key.`, [
            'name an ISO instant between the years 1830 and 2109',
          ]);
        }
      }
      const excluded = reader.kind === 'thread' && request.threadId !== reader.threadId ? reader.threadId : null;
      const question = createHash('sha256')
        .update(
          JSON.stringify([
            terms.matched,
            terms.short,
            request.scope,
            request.since ?? null,
            request.before ?? null,
            request.threadId ?? null,
            excluded,
          ]),
        )
        .digest('hex');
      const held = request.cursor === undefined ? null : yield* reads.heldSearch(reader, request.cursor);
      if (held !== null && held.question !== question) {
        return yield* Effect.fail(
          new ThreadInputRefused('cursor-stale', 'This cursor continues another search.', ['search again without a cursor']),
        );
      }
      const range = rangeOf(request);
      const threadId = request.threadId;
      const layers = threadId === undefined ? [] : yield* units.read((unit) => layersOf(db, unit, threadId));
      const perThread = request.threadId === undefined;
      const narrowed = terms.short.length > 0;

      const scan = Effect.fnUntraced(function* (match: string, from: ConversationHeld | null) {
        const emitted = new Set(from?.emitted ?? []);
        const fresh: string[] = [];
        const accepted: { readonly seen: Seen; text: string | null }[] = [];
        let viewed = 0;
        let boundary: string | null = from?.boundary ?? null;
        let exhausted = false;
        const full = (): boolean => accepted.length >= request.limit || viewed >= PAGE_MATCHES;
        while (!full()) {
          const chunk = yield* units.read((unit) =>
            unit.run(
              db.all<Seen>(chunkOf(match, request, range(boundary), excluded, narrowed ? sql`${threadMessage.text}` : null, layers)),
            ),
          );
          let read = 0;
          for (const row of chunk) {
            read += 1;
            viewed += 1;
            boundary = boundaryOf(row.key, row.thread_id, perThread);
            const text = row.text ?? null;
            if (
              !(perThread && emitted.has(row.thread_id)) &&
              (!narrowed || (text !== null && terms.short.every((term) => projectionOf(text).includes(term))))
            ) {
              if (perThread) {
                emitted.add(row.thread_id);
                fresh.push(row.thread_id);
              }
              accepted.push({ seen: row, text });
            }
            if (full()) break;
          }
          if (chunk.length < CHUNK && read === chunk.length) {
            exhausted = true;
            break;
          }
        }
        return { fresh, accepted, boundary, exhausted };
      });

      const spelled = Effect.fnUntraced(function* () {
        const near = nearQuery(request.query);
        if (near === null) return null;
        const sample = yield* units.read((unit) =>
          unit.run(
            db.all<Seen>(
              chunkOf(
                near.expression,
                request,
                range(null),
                excluded,
                sql`substr(${threadMessage.text}, 1, ${SPELLING_SAMPLE.chars})`,
                layers,
              ),
            ),
          ),
        );
        const spelling = spellingsOf(
          near,
          sample.slice(0, SPELLING_SAMPLE.rows).flatMap((row) => (row.text === undefined ? [] : [row.text])),
        );
        return spelling === null ? null : { match: matchExpression(spelling.terms), stems: spelling.stems };
      });

      const strict = { match: matchExpression(terms.matched), stems: terms.stems };
      const carried = held?.spelled;
      const first = yield* scan((carried ?? strict).match, held);
      const unanswered = carried === undefined && (held?.answered ?? 0) === 0 && first.accepted.length === 0 && first.exhausted;
      const retried = unanswered ? yield* spelled() : null;
      const { fresh, accepted, boundary, exhausted } = retried === null ? first : yield* scan(retried.match, null);
      const approximate = carried !== undefined || (retried !== null && (accepted.length > 0 || !exhausted));
      const searched = approximate ? (retried ?? carried ?? strict) : strict;
      const match = searched.match;
      const missing = accepted.filter((hit) => hit.text === null).map((hit) => hit.seen.key);
      const texts = missing.length === 0 ? new Map<string, string>() : yield* textsOf(missing);
      const matches: ConversationHit[] = accepted.map(({ seen, text }) => {
        const shown = snippetOf(text ?? texts.get(seen.key) ?? '', searched.stems, SNIPPET);
        return {
          project: seen.project_id === null ? null : { id: seen.project_id, name: seen.project_name ?? String(seen.project_id) },
          threadId: seen.thread_id,
          title: seen.title,
          name: seen.name,
          parentId: seen.parent_id,
          archived: seen.archived === 1,
          match: {
            entryId: seen.entry_id,
            position: seen.position,
            runId: seen.run_id,
            role: seen.role,
            occurredAt: instant(seen.occurred_at),
            snippet: shown.snippet,
            highlights: shown.highlights,
          },
        };
      });
      const answered = (held?.answered ?? 0) + matches.length;
      const tally: ConversationTally = narrowed
        ? {
            total: exhausted ? answered : null,
            atLeast: exhausted ? undefined : answered,
            cut: exhausted ? undefined : ('short-terms' as const),
          }
        : ((retried === null ? held?.tally : undefined) ?? (yield* tallyOf(match, request, range, excluded, layers)));
      const coverage = held?.coverage ?? (yield* coverageOf(request, layers));
      const cut = !exhausted && accepted.length < request.limit ? ('match-limit' as const) : null;
      const cursor =
        exhausted || boundary === null
          ? null
          : yield* reads.holdSearch(
              reader,
              {
                question,
                boundary,
                emitted: [...(held?.emitted ?? []), ...fresh],
                answered,
                tally,
                coverage,
                excluded,
                spelled: approximate ? searched : undefined,
              },
              request.cursor ?? null,
            );
      return { matches, tally, coverage, excluded, cursor, cut, approximate };
    }),

    window: Effect.fn('Conversations.window')(function* (projectId, request) {
      if (request.around > AROUND) {
        return yield* new GateRefusal(
          'selection-shape',
          `A conversation window carries at most ${AROUND} messages each side, whole; ${request.around} were asked.`,
          [`ask \`around\` of ${AROUND} or fewer, and open the next window from its outermost message`],
        );
      }
      const windows: ConversationWindow[] = [];
      for (const address of request.addresses) {
        const owner = yield* units.read((unit) =>
          unit.run(
            db.all<{ readonly project_id: number | null }>(
              sql`select ${threadRecord.projectId} as project_id from ${threadRecord} where ${threadRecord.id} = ${address.threadId}`,
            ),
          ),
        );
        const held = owner[0];
        if (held === undefined) {
          windows.push({ threadId: address.threadId, at: address.at, missing: 'no thread of this project has this id' });
          continue;
        }
        if (held.project_id !== projectId) {
          if (held.project_id === null) {
            windows.push({ threadId: address.threadId, at: address.at, missing: 'no thread of this project has this id' });
            continue;
          }
          return yield* Effect.fail(new ThreadRefused(address.threadId, held.project_id));
        }
        const messages = yield* units.read((unit) =>
          Effect.gen(function* () {
            const heard = heardIn(address.threadId, yield* layersOf(db, unit, address.threadId));
            const anchor = yield* unit.run(
              db.all<Spoken>(sql`${spoken()} where ${heard}
                and ${typeof address.at === 'number' ? sql`${threadMessage.position} = ${address.at}` : sql`${threadMessage.entryId} = ${address.at}`}`),
            );
            const at = anchor[0];
            if (at === undefined) return null;
            const before = yield* unit.run(
              db.all<Spoken>(sql`${spoken()} where ${heard} and ${threadMessage.position} < ${at.position}
                order by ${threadMessage.position} desc limit ${request.around}`),
            );
            const after = yield* unit.run(
              db.all<Spoken>(sql`${spoken()} where ${heard} and ${threadMessage.position} > ${at.position}
                order by ${threadMessage.position} asc limit ${request.around}`),
            );
            return [...before.reverse(), at, ...after];
          }),
        );
        windows.push(
          messages === null
            ? { threadId: address.threadId, at: address.at, missing: 'no conversational message stands at this address' }
            : {
                threadId: address.threadId,
                at: address.at,
                messages: messages.map((row) => ({
                  entryId: row.entry_id,
                  at: row.position,
                  runId: row.run_id,
                  role: row.role,
                  occurredAt: instant(row.occurred_at),
                  text: row.text,
                })),
              },
        );
      }
      return windows;
    }),
  });
});
