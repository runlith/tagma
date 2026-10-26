import { Effect, Layer } from 'effect';
import { resolveAcross } from '../contract/wire/tags/selector.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { carriedSelection, page, pageRows, readCursor, walkQuestion, type PageQuestion } from '@runlith/paging';
import { SEARCH_WALK } from '../contract/wire/walks.js';
import { BLOCKS } from '../contract/wire/operations/shared.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { type SearchPage } from '../contract/wire/reads.js';
import { type SQL, inArray, sql } from 'drizzle-orm';
import { block, compactUuid, searchIndex } from '../store/tables.js';
import { blockOwners } from '../store/owners.js';
import { Tags } from '../contract/service/vocabulary.js';
import { carriesTag, slotIn } from '../vocabulary/projection.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { sourcePathsCondition } from '../sources/readers/place.js';
import { likeLiteral } from '../acts/rows.js';
import { type BlockRow } from '../contract/service/acts.js';
import { type FirstPageInput, type RankingSearchInput, Ranking } from '../contract/service/reads.js';
import { Selection } from '../contract/service/reads.js';
import { scopeCondition } from './selection.js';
import { GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { searchTerms } from './words.js';
import { matchExpression, nearQuery, SPELLING_SAMPLE, spellingsOf } from '@runlith/search-text/fts';
import { standingCondition } from '../work/standingCondition.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { CurrentGraph } from '../contract/service/serving.js';

const NAME_QUERY = /^[0-9a-f]{4,32}$/i;

type SearchPageRow = { id: number; updated_at: number; tier: number; total: number };
type SearchCursor = { tier: number; updatedAt: number; id: number };
type Terms = readonly (readonly string[])[];

function searchCandidates(terms: Terms, name: string | undefined): SQL {
  const parts: SQL[] = [];
  if (terms.length > 0) {
    parts.push(sql`select rowid as id from search_fts where search_fts.text match ${matchExpression(terms)}`);
  }
  if (name !== undefined) {
    parts.push(sql`select ${block.id} as id from ${block} where ${compactUuid} like ${`%${name}%`}`);
  }
  return sql.join(parts, sql` union `);
}

function searchTierExpression(terms: Terms, name: string | undefined): SQL {
  const cases: SQL[] = [];
  if (name !== undefined) {
    cases.push(sql`when ${compactUuid} like ${`%${name}`} then -2`);
    cases.push(sql`when ${compactUuid} like ${`%${name}%`} then -1`);
  }
  if (terms.length > 0) {
    const any = (each: (term: string) => SQL) => terms.map((spellings) => sql`(${sql.join(spellings.map(each), sql` or `)})`);
    const whole = any((term) => sql`(' ' || ${searchIndex.titleText} || ' ') like ${`% ${likeLiteral(term)} %`} escape '\\'`);
    const part = any((term) => sql`${searchIndex.titleText} like ${`%${likeLiteral(term)}%`} escape '\\'`);
    cases.push(sql`when ${sql.join(whole, sql` and `)} then 0`);
    cases.push(sql`when ${sql.join(part, sql` and `)} then 1`);
    cases.push(sql`when ${sql.join(part, sql` or `)} then 2`);
  }
  return cases.length === 0 ? sql`0` : sql`case ${sql.join(cases, sql` `)} else 3 end`;
}

function searchQuestion(input: RankingSearchInput, checkout: string | null, spelled: Terms | undefined): PageQuestion {
  return walkQuestion(SEARCH_WALK, {
    spelled,
    query: input.query.trim(),
    tag: input.tag,
    selector: input.selector,
    status: input.status,
    path: input.path,
    history: input.history,
    scopeId: input.scopeId,
    projectId: input.projectId,
    checkout,
  });
}

function readSearchCursor(
  value: string | undefined,
  question: PageQuestion,
): Effect.Effect<SearchCursor | null, GateRefusal<'bad-cursor' | 'cursor-stale'>> {
  if (value === undefined || value === '') return Effect.succeed(null);
  const read = readCursor(value, question);
  if ('refused' in read) return cursorRefusal(read.refused);
  const [tier, updatedAt, id] = read.at;
  if (read.at.length !== 3 || typeof tier !== 'number' || typeof updatedAt !== 'number' || typeof id !== 'number') {
    return cursorRefusal('bad-cursor');
  }
  return Effect.succeed({ tier, updatedAt, id });
}

export const rankingLayer: Layer.Layer<Ranking, never, GraphStore | Selection | Tags | GraphUnits> = Layer.effect(
  Ranking,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const reads = readsOf(yield* GraphUnits);
    const selection = yield* Selection;
    const vocabulary = yield* Tags;

    const tablesOf = Effect.fn('Ranking.tablesOf')(function* (projectId?: number) {
      const tables = new Map<number, TagTable>();
      const owners = projectId === undefined ? yield* blockOwners(db) : [projectId];
      for (const owner of owners) tables.set(owner, yield* vocabulary.of(owner));
      return tables;
    });

    const rankPage = Effect.fn('Ranking.page')(function* (
      input: RankingSearchInput,
      tables: ReadonlyMap<number, TagTable>,
      cursor: SearchCursor | null,
      inside: SQL | undefined,
      questionOf: (spelled: Terms | undefined) => PageQuestion,
      forgiving: boolean,
      carried: Terms | undefined,
    ): Effect.fn.Return<SearchPage, StoreFailure | GateRefusal<'query-shape'>> {
      const query = input.query.trim();
      const filters: SQL[] = [sql`${block.deletedAt} is null`];
      if (input.scopeId !== undefined) filters.push(scopeCondition(input.scopeId));
      if (input.tag !== undefined && input.selector !== undefined) {
        return yield* new GateRefusal('query-shape', 'tag and selector name two type selections', [
          'name selector, or keep tag for an exact selection',
        ]);
      }
      const selector = input.selector ?? (input.tag === undefined ? undefined : { kind: 'exact' as const, types: [input.tag] });
      const selected = selector === undefined ? undefined : resolveAcross(tables, selector);
      if (selected?._tag === 'Failure') {
        return yield* new GateRefusal(
          'query-shape',
          `${selected.failure.kind}: "${selected.failure.ref}" resolves to no unique declaration`,
          ['read this project’s vocabulary and name a declared type or registered contract'],
        );
      }
      const status = input.status;
      const namesHistory =
        input.history === true ||
        NAME_QUERY.test(query) ||
        (status !== undefined && [...tables.values()].some((table) => table.hiddenStatuses().includes(status)));
      const each: SQL[] = [];
      for (const [owner, table] of tables) {
        const keys = selected?.success.get(owner);
        if (keys?.length === 0) continue;
        const conditions = [sql`${block.projectId} = ${owner}`];
        if (keys !== undefined) conditions.push(carriesTag(keys, block.id));
        if (status !== undefined) conditions.push(slotIn(table, LIFECYCLE, 'status', [status], block.id));
        if (!namesHistory) conditions.push(standingCondition(table));
        each.push(sql`(${sql.join(conditions, sql` and `)})`);
      }
      filters.push(each.length === 0 ? sql`0` : sql`(${sql.join(each, sql` or `)})`);
      if (inside !== undefined) filters.push(inside);

      const where = sql.join(filters, sql` and `);
      const named = NAME_QUERY.test(query.trim()) ? query.trim().toLowerCase() : undefined;
      const size = pageRows(input.limit, BLOCKS, ceilingOf(BLOCKS));

      const ranked = Effect.fnUntraced(function* (terms: Terms) {
        const hit = sql`
          select ${block.id} as id, ${block.updatedAt} as updated_at, ${searchTierExpression(terms, named)} as tier
          from ${
            terms.length > 0 || named !== undefined
              ? sql`(${searchCandidates(terms, named)}) as candidate cross join ${block} on candidate.id = ${block.id}`
              : sql`${block}`
          }
          ${terms.length > 0 ? sql`cross join ${searchIndex} on ${searchIndex.blockId} = ${block.id}` : sql``}
          where ${where}`;
        const keyset = cursor
          ? sql`where tier > ${cursor.tier} or (tier = ${cursor.tier} and (updated_at < ${cursor.updatedAt}
              or (updated_at = ${cursor.updatedAt} and id < ${cursor.id})))`
          : sql``;
        const rows = yield* db.all<SearchPageRow>(sql`
          with hit as (${hit}), counted as (select hit.*, count(*) over () as total from hit)
          select * from counted ${keyset} order by tier asc, updated_at desc, id desc limit ${size + 1}`);
        const total =
          rows[0]?.total ??
          (cursor === null
            ? 0
            : ((yield* db.all<{ total: number }>(sql`with hit as (${hit}) select count(*) as total from hit`))[0]?.total ?? 0));
        return { rows, total };
      });

      const spelled = Effect.fnUntraced(function* () {
        const near = named === undefined ? nearQuery(query) : null;
        if (near === null) return null;
        const sample = yield* db.all<{ text: string }>(sql`
          select substr(${block.title} || char(10) || ${block.body}, 1, ${SPELLING_SAMPLE.chars}) as text
          from (select rowid as id from search_fts where search_fts.text match ${near.expression}) as candidate
          cross join ${block} on candidate.id = ${block.id}
          where ${where}
          order by candidate.id desc limit ${SPELLING_SAMPLE.rows}`);
        return spellingsOf(
          near,
          sample.map((row) => row.text),
        );
      });

      const chosen = Effect.fnUntraced(function* () {
        if (carried !== undefined) return { found: yield* ranked(carried), terms: carried };
        const strict = searchTerms(query).map((term) => [term]);
        const exact = yield* ranked(strict);
        if (!forgiving || cursor !== null || exact.total > 0 || strict.length === 0) return { found: exact, terms: undefined };
        const spelling = yield* spelled();
        if (spelling === null) return { found: exact, terms: undefined };
        const close = yield* ranked(spelling.terms);
        return close.total > 0 ? { found: close, terms: spelling.terms } : { found: exact, terms: undefined };
      });

      const {
        found: { rows, total },
        terms,
      } = yield* chosen();
      const approximate = terms !== undefined;
      const cut = page({
        rows,
        asked: size,
        keyOf: (row) => [row.tier, row.updated_at, row.id],
        question: questionOf(terms),
        total,
      });
      const shown = yield* db
        .select()
        .from(block)
        .where(
          inArray(
            block.id,
            cut.rows.map((row) => row.id),
          ),
        );
      const byId = new Map(shown.map((row) => [row.id, row] as const));
      const ordered: BlockRow[] = [];
      for (const hitRow of cut.rows) {
        const row = byId.get(hitRow.id);
        if (row !== undefined) ordered.push(row);
      }
      return {
        items: yield* selection.list(ordered, ['superseded']),
        nextCursor: cut.next,
        total,
        approximate,
      };
    });

    return Ranking.of({
      firstPage: reads(
        Effect.fn('Ranking.firstPage')(function* (input: FirstPageInput) {
          const checkout = (yield* CurrentGraph)?.checkout ?? null;
          return yield* rankPage(
            input,
            yield* tablesOf(input.projectId),
            null,
            undefined,
            (spelled) => searchQuestion(input, checkout, spelled),
            false,
            undefined,
          );
        }),
      ),
      search: reads(
        Effect.fn('Ranking.search')(function* (
          input: RankingSearchInput,
        ): Effect.fn.Return<SearchPage, StoreFailure | GateRefusal<'bad-cursor' | 'cursor-stale' | 'source-outside' | 'query-shape'>> {
          const tables = yield* tablesOf(input.projectId);
          if (input.tag !== undefined && input.selector !== undefined) {
            return yield* new GateRefusal('query-shape', 'tag and selector name two type selections', [
              'name selector, or keep tag for an exact selection',
            ]);
          }
          const selector = input.selector ?? (input.tag === undefined ? undefined : { kind: 'exact' as const, types: [input.tag] });
          if (selector !== undefined && selector.kind !== 'supports') {
            const pinned = new Set<string>();
            for (const ref of selector.types) {
              let found = false;
              for (const table of tables.values()) {
                const type = table.identities.typeOf(ref);
                if (type === null) continue;
                pinned.add(type.id);
                found = true;
              }
              if (!found) pinned.add(ref);
            }
            input = { ...input, tag: undefined, selector: { ...selector, types: [...pinned] } };
          }
          const checkout = (yield* CurrentGraph)?.checkout ?? null;
          const carried = carriedSelection(SEARCH_WALK, input.cursor)?.spelled;
          const cursor = yield* readSearchCursor(input.cursor, searchQuestion(input, checkout, carried));
          const inside = input.path === undefined ? undefined : yield* sourcePathsCondition([input.path]);
          const asked = (spelled: Terms | undefined) => searchQuestion(input, checkout, spelled);
          return yield* rankPage(input, tables, cursor, inside, asked, true, carried);
        }),
      ),
    });
  }),
);
