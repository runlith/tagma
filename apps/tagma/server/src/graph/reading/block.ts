import { Effect, Layer } from 'effect';
import { rests, standsInOutline } from '../contract/wire/standing.js';
import { type ViewResults } from '../contract/wire/reads.js';
import { type ZonePage, type ZoneSection, zonePage } from '../voice/zonePage.js';
import { aliasedTable, and, eq, inArray, isNull } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, edge, farEdge, ref } from '../store/tables.js';
import { farEndOf, farPointers, farStates } from '../acts/far.js';
import { farKey } from '../contract/wire/far.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { BlockRows } from '../acts/rows.js';
import { type BlockRow, BlockAnswers, BlockNames, MEASURED_FACTS } from '../contract/service/acts.js';
import { selectionOf } from '../contract/wire/tags/selection.js';
import { OBSERVATION } from '../contract/wire/tags/observation.js';
import type { BlockQuery } from '../contract/wire/query.js';
import { readField } from '../vocabulary/declarationRules.js';
import { blockName, blockRefTargets } from '../contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { BlockReads, Selection, type BlockDetail, type SelectionRefusal } from '../contract/service/reads.js';
import { Tags } from '../contract/service/vocabulary.js';
import { answeredNames, crossable, elsewhereNames } from './names.js';
import type { RefElsewhere } from '../contract/wire/far.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Review, Tasks } from '../contract/service/work.js';
import { GraphJournal } from '../contract/service/journal.js';
import { Sources } from '../contract/service/sources.js';
import { appendTagPrompts, tagPrompts, tagPromptText } from '../orientation/tagPrompts.js';
import { lawReach, reachLabel } from '../orientation/reach.js';

export const ZONE_PAGE_BUDGET = 20_000;

export const blockReadsLayer: Layer.Layer<
  BlockReads,
  never,
  GraphStore | GraphUnits | BlockNames | BlockAnswers | BlockRows | Selection | Sources | GraphJournal | Review | Tasks | Projects | Tags
> = Layer.effect(
  BlockReads,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const reads = readsOf(yield* GraphUnits);
    const blockNames = yield* BlockNames;
    const blockAnswers = yield* BlockAnswers;
    const blockRows = yield* BlockRows;
    const vocabulary = yield* Tags;
    const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);
    const selection = yield* Selection;
    const projects = yield* Projects;
    const sources = yield* Sources;
    const journal = yield* GraphJournal;
    const review = yield* Review;
    const tasks = yield* Tasks;
    const lawGraph = yield* Effect.context<GraphStore | Tags>();

    const viewResults = Effect.fn('Reading.viewResults')(function* (
      projectId: number,
      query: BlockQuery,
    ): Effect.fn.Return<ViewResults, StoreFailure | GateRefusal<SelectionRefusal>> {
      const missingScope: string[] = [];
      for (const name of query.scope ?? []) {
        const found = yield* blockNames.idOfName(name);
        if (found === null || (yield* blockRows.liveBlock(found)) === undefined) missingScope.push(name);
      }
      if (missingScope.length > 0) return { items: [], total: 0, missingScope };
      return { ...(yield* selection.query(projectId, query)), missingScope: [] };
    });

    const savedQuery = Effect.fn('Reading.savedQuery')(function* (
      row: BlockRow,
    ): Effect.fn.Return<BlockQuery | null, GateRefusal<'field-invalid'> | StoreFailure> {
      const table = yield* tableOf(row);
      const binding = table
        .tagsOf(row)
        .map(selectionOf)
        .find((entry) => entry !== null);
      return binding === undefined ? null : yield* readField(row, binding.query, 'blockQuery');
    });

    const standingKids = Effect.fnUntraced(function* (
      parentId: number,
      all: boolean,
    ): Effect.fn.Return<(BlockRow & { superseded: boolean; answered: boolean })[], StoreFailure> {
      const kids = yield* blockRows.records(yield* blockRows.childrenOf(parentId), ['superseded', 'answered']);
      const standing: (BlockRow & { superseded: boolean; answered: boolean })[] = [];
      for (const kid of kids) {
        const table = yield* tableOf(kid);
        if (!standsInOutline(table, kid)) continue;
        if (all || !rests(table, kid)) {
          standing.push(kid);
          continue;
        }
        standing.push(...(yield* standingKids(kid.id, all)));
      }
      return standing;
    });

    const readPage = Effect.fn('Reading.page')(function* (
      rootId: number,
      depth: number,
      all: boolean,
    ): Effect.fn.Return<BlockDetail, StoreFailure | GateRefusal<'not-found' | 'deleted'>> {
      const outline = yield* selection.outline(rootId, depth, all);
      const measured = yield* blockRows.records(outline.rows, ['superseded', 'blocked', 'building', 'answered']);
      const records = new Map(measured.map((row) => [row.id, row] as const));
      const root = records.get(rootId);
      if (root === undefined) return yield* Effect.die(`outline lost root block ${rootId}`);
      const table = yield* tableOf(root);
      const ids = measured.map((row) => row.id);
      const readProject = records.get(rootId)?.projectId;
      const measuredBy = yield* sources.byBlock(ids);
      const verdicts = yield* review.verdicts(measured);
      const endings = yield* tasks.endings(measured);
      const authors = yield* journal.authors(ids);
      const answers = yield* blockAnswers.answersOf(measured.flatMap((row) => (table.supports(row, OBSERVATION) ? [row.id] : [])));
      const answerNames = yield* blockNames.namesOf(
        [...answers.values()].flatMap((answer) => (answer.kind === 'block' ? [answer.id] : [])),
      );
      const lawful = measured.some((row) => table.lawProjection(row) !== null);
      const reaches = lawful ? yield* Effect.provide(lawReach(root.projectId), lawGraph) : null;
      const projectName = lawful ? (yield* projects.byId(root.projectId)).name : '';
      const reachOf = (id: number): string | null => {
        const reach = reaches?.get(id);
        return reach === undefined ? null : reachLabel(reach, projectName);
      };

      const edgesOut = new Map<number, BlockDetail['edgesOut']>();
      const outTarget = aliasedTable(block, 'readOutTarget');
      for (const item of yield* db
        .select({
          blockId: edge.fromId,
          row: edge,
          tags: outTarget.tags,
          fields: outTarget.fields,
          farUuid: outTarget.uuid,
        })
        .from(edge)
        .innerJoin(outTarget, eq(outTarget.id, edge.toId))
        .where(and(inArray(edge.fromId, ids), isNull(outTarget.deletedAt)))) {
        if (item.row.kind === 'amends' && !standsInOutline(table, item)) continue;
        const near = records.get(item.blockId);
        if (near === undefined) continue;
        const grouped = edgesOut.get(item.blockId) ?? [];
        grouped.push({ ...item.row, fromUuid: near.uuid, toUuid: item.farUuid });
        edgesOut.set(item.blockId, grouped);
      }
      const farOut = yield* db.select().from(farEdge).where(inArray(farEdge.fromId, ids));
      const farStated = yield* farStates(farOut, LIFECYCLE);
      for (const row of farOut) {
        const near = records.get(row.fromId);
        const state = farStated.get(farKey(row));
        if (near === undefined || state === undefined || (state.kind === 'here' && state.trashed)) continue;
        const grouped = edgesOut.get(row.fromId) ?? [];
        grouped.push({ ...row, toId: null, fromUuid: near.uuid, toUuid: row.uuid, far: farEndOf(row, state) });
        edgesOut.set(row.fromId, grouped);
      }

      const inSource = aliasedTable(block, 'readInSource');
      const edgeRows = yield* db
        .select({
          blockId: edge.toId,
          row: edge,
          farId: inSource.id,
          projectId: inSource.projectId,
          tags: inSource.tags,
          fields: inSource.fields,
          farUuid: inSource.uuid,
        })
        .from(edge)
        .innerJoin(inSource, eq(inSource.id, edge.fromId))
        .where(and(inArray(edge.toId, ids), isNull(inSource.deletedAt)));
      const refSource = aliasedTable(block, 'readRefSource');
      const refRows = yield* db
        .select({
          blockId: ref.toId,
          farId: refSource.id,
          projectId: refSource.projectId,
          tags: refSource.tags,
          fields: refSource.fields,
          uuid: refSource.uuid,
        })
        .from(ref)
        .innerJoin(refSource, eq(refSource.id, ref.fromId))
        .where(and(inArray(ref.toId, ids), isNull(refSource.deletedAt)));
      const resting = new Set<number>();
      if (!all) {
        const far = new Map<number, { id: number; projectId: number; tags: readonly string[]; fields: Record<string, unknown> }>();
        for (const item of [...edgeRows, ...refRows]) {
          far.set(item.farId, { id: item.farId, projectId: item.projectId, tags: item.tags, fields: item.fields });
        }
        for (const row of yield* blockRows.records([...far.values()], ['superseded', 'answered'])) {
          if (rests(yield* tableOf(row), row)) resting.add(row.id);
        }
      }

      const edgesIn = new Map<number, BlockDetail['edgesIn']>();
      const restingEdges = new Map<number, BlockDetail['edgesIn']>();
      for (const item of edgeRows) {
        if (item.row.kind === 'amends' && !standsInOutline(table, item)) continue;
        const near = records.get(item.blockId);
        if (near === undefined) continue;
        const into = item.row.kind !== 'amends' && resting.has(item.farId) ? restingEdges : edgesIn;
        const grouped = into.get(item.blockId) ?? [];
        grouped.push({ ...item.row, fromUuid: item.farUuid, toUuid: near.uuid });
        into.set(item.blockId, grouped);
      }
      const byUuid = new Map(measured.map((row) => [row.uuid, row] as const));
      const incoming = yield* farPointers(db, root.projectId, [...byUuid.keys()]);
      const edgesInUnread = incoming.unread.map((project) => project.name);
      for (const pointer of incoming.pointers) {
        const near = byUuid.get(pointer.to);
        if (near === undefined) continue;
        const into = pointer.superseded || pointer.phase === 'terminal' ? restingEdges : edgesIn;
        const grouped = into.get(near.id) ?? [];
        grouped.push({
          kind: pointer.kind,
          fromId: null,
          toId: near.id,
          createdBySessionId: null,
          createdAt: new Date(pointer.at),
          fromUuid: pointer.from,
          toUuid: near.uuid,
          far: { project: pointer.project.name, projectId: pointer.project.id, state: 'here', title: pointer.title, reason: null },
        });
        into.set(near.id, grouped);
      }

      const refsOut = new Map<number, string[]>();
      const indexed = new Map<number, string[]>();
      const refTarget = aliasedTable(block, 'readRefTarget');
      for (const item of yield* db
        .select({ blockId: ref.fromId, uuid: refTarget.uuid })
        .from(ref)
        .innerJoin(refTarget, eq(refTarget.id, ref.toId))
        .where(inArray(ref.fromId, ids))) {
        const grouped = refsOut.get(item.blockId) ?? [];
        grouped.push(blockName(item.uuid));
        refsOut.set(item.blockId, grouped);
        const compact = indexed.get(item.blockId) ?? [];
        compact.push(item.uuid.replaceAll('-', ''));
        indexed.set(item.blockId, compact);
      }
      const written = new Map<number, string[]>();
      for (const row of measured) {
        const held = indexed.get(row.id) ?? [];
        const names = blockRefTargets(row.body).filter((name) => !held.some((uuid) => uuid.endsWith(name)));
        if (names.length > 0) written.set(row.id, names);
      }
      const union = [...new Set([...written.values()].flat())];
      const refsElsewhere = new Map<number, RefElsewhere[]>();
      const refsAbsent = new Map<number, string[]>();
      if (union.length > 0 && readProject !== undefined) {
        const here = yield* answeredNames(db, readProject, union);
        const far = yield* elsewhereNames(db, projects, readProject, crossable(here));
        for (const [id, names] of written) {
          const reached: string[] = [];
          const elsewhere: RefElsewhere[] = [];
          const absent: string[] = [];
          for (const name of names) {
            const found = far.found.get(name);
            if (found !== undefined) {
              reached.push(found.ref.name);
              if (!found.global) elsewhere.push(found.ref);
            } else if (here.get(name)?.kind === 'absent' && far.settled.has(name)) absent.push(name);
          }
          if (reached.length > 0) refsOut.set(id, [...(refsOut.get(id) ?? []), ...reached]);
          if (elsewhere.length > 0) refsElsewhere.set(id, elsewhere);
          if (absent.length > 0) refsAbsent.set(id, absent);
        }
      }

      const refsIn = new Map<number, string[]>();
      const restingRefs = new Map<number, string[]>();
      for (const item of refRows) {
        const into = resting.has(item.farId) ? restingRefs : refsIn;
        const grouped = into.get(item.blockId) ?? [];
        grouped.push(blockName(item.uuid));
        into.set(item.blockId, grouped);
      }

      const project = Effect.fnUntraced(function* (row: (typeof measured)[number], remainingDepth: number): Effect.fn.Return<BlockDetail> {
        const shape = outline.shapes.get(row.id);
        if (shape === undefined) return yield* Effect.die(`outline lost shape for block ${row.id}`);
        const answer = answers.get(row.id);
        const answeredBy = answer?.kind === 'block' ? answerNames.get(answer.id) : null;
        if (answer?.kind === 'block' && answeredBy === undefined) {
          return yield* Effect.die(`no block ${answer.id} to name as the answer to ${row.id}`);
        }
        return {
          ...row,
          children:
            remainingDepth === 0
              ? []
              : yield* Effect.forEach(outline.children.get(row.id) ?? [], (id) => project(records.get(id)!, remainingDepth - 1)),
          shape,
          sources: measuredBy.get(row.id) ?? [],
          reach: reachOf(row.id),
          verdict: verdicts.get(row.id) ?? null,
          ending: endings.get(row.id) ?? null,
          author: authors.get(row.id) ?? null,
          answeredBy: answeredBy ?? null,
          answeredCommit: answer?.kind === 'commit' ? answer.sha : null,
          answeredCheck: answer?.kind === 'checked' ? { finding: answer.finding, head: answer.head } : null,
          results: null,
          edgesOut: [...(edgesOut.get(row.id) ?? [])],
          edgesIn: [...(edgesIn.get(row.id) ?? [])],
          edgesInUnread: byUuid.has(row.uuid) ? edgesInUnread : [],
          refsOut: refsOut.get(row.id) ?? [],
          refsElsewhere: refsElsewhere.get(row.id) ?? [],
          refsAbsent: refsAbsent.get(row.id) ?? [],
          refsIn: refsIn.get(row.id) ?? [],
          restingIn: { edges: restingEdges.get(row.id) ?? [], refs: restingRefs.get(row.id) ?? [] },
        };
      });

      return yield* project(root, depth);
    });

    return BlockReads.of({
      show: reads(
        Effect.fn('Reading.show')(function* (
          id: number,
          depth: number,
          all?: boolean,
        ): Effect.fn.Return<BlockDetail, StoreFailure | GateRefusal<SelectionRefusal | 'not-found' | 'deleted' | 'field-invalid'>> {
          const row = yield* blockRows.blockById(id);
          const read = yield* readPage(row.id, depth, all === true);
          const query = yield* savedQuery(row);
          return query === null ? read : { ...read, results: yield* viewResults(read.projectId, query) };
        }),
      ),

      zone: reads(
        Effect.fn('Reading.zone')(function* (
          id: number,
          cursor?: string,
          deliveredTags?: ReadonlySet<string>,
        ): Effect.fn.Return<
          ZonePage & { total: number; deliveredTags: readonly string[] },
          StoreFailure | GateRefusal<'not-found' | 'deleted' | 'bad-cursor'>
        > {
          const root = yield* blockRows.blockById(id);
          const sections: ZoneSection[] = [];
          const walk = Effect.fnUntraced(function* (row: BlockRow, depth: number): Effect.fn.Return<void, StoreFailure> {
            const [record] = yield* blockRows.records([row], MEASURED_FACTS);
            if (record === undefined) return yield* Effect.die(`zone lost block ${row.id}`);
            sections.push({
              name: blockName(record.uuid),
              tags: record.tags,
              fields: record.fields,
              title: record.title,
              superseded: record.superseded,
              blocked: record.blocked,
              building: record.building,
              answered: record.answered,
              depth,
              sources: (yield* sources.of(row.id)).map((one) => ({ kind: one.kind, ref: one.ref, symbol: one.symbol })),
              body: record.body,
            });
            for (const child of yield* standingKids(row.id, false)) yield* walk(child, depth + 1);
          });
          yield* walk(root, 0);
          const start = cursor === undefined ? 0 : sections.findIndex((section) => section.name === cursor) + 1;
          if (cursor !== undefined && start === 0) {
            return yield* new GateRefusal('bad-cursor', `${cursor} is not in this zone's walk`, [
              'continue with the `next` the previous page answered, or start over without a cursor',
            ]);
          }
          const table = yield* tableOf(root);
          const pendingPrompts =
            deliveredTags === undefined
              ? null
              : tagPromptText(
                  tagPrompts(
                    table,
                    root.projectId,
                    sections.slice(start).flatMap((section) => section.tags),
                  ),
                  deliveredTags,
                ).text;
          const promptBudget = pendingPrompts === null ? 0 : pendingPrompts.length + 2;
          const page = zonePage(table, sections, start, Math.max(0, ZONE_PAGE_BUDGET - promptBudget));
          const shown = sections.slice(start, start + page.shown);
          const carried = appendTagPrompts(
            page.page,
            table,
            root.projectId,
            shown.flatMap((section) => section.tags),
            deliveredTags,
          );
          return {
            ...page,
            page: carried.text,
            total: sections.length,
            deliveredTags: carried.delivered,
          };
        }),
      ),
    });
  }),
);
