import { Effect } from 'effect';
import { carriedSelection, pageRows } from '@runlith/paging';
import { QUERY_WALK, SEARCH_WALK } from '../contract/wire/walks.js';
import { BLOCKS } from '../contract/wire/operations/shared.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { BlockNames } from '../contract/service/acts.js';
import { Blocks, type FarLink, Trash } from '../contract/service/blocks.js';
import { Ranking, Selection } from '../contract/service/reads.js';
import { withBodyFile } from '../blocks/bodyFile.js';
import { GateRefusal, cursorRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { callerPath, callerReads } from '../../platform/contract/service/subjects.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { pairsOf, routed, routesOf } from '../../platform/contract/service/routed.js';
import { type BlockQuery } from '../contract/wire/query.js';
import type { QueryPage } from '../contract/service/reads.js';
import type { SearchPage } from '../contract/wire/reads.js';

import { type BlockCreate } from '../contract/wire/creation.js';
import { blockName } from '../contract/wire/references.js';
import { WRITE_OPERATIONS } from '../contract/wire/operations/writes.js';
import { READ_OPERATIONS } from '../contract/wire/operations/reads.js';
import { pricedBlockResult, pricedResult } from './answers.js';
import { birthPricing, lawPricing, nodePricing } from './start.js';
import { priced, type Priced } from '../../platform/contract/service/start.js';
import type { BlockWrite } from '../contract/service/acts.js';
import type { Moved } from '../contract/wire/answers.js';
import { cross, link, linkTarget, scoped, targeted, unlink } from './crossing.js';
import { relocate } from './relocation.js';
import { GraphCall } from '../contract/service/serving.js';
import { type Published, publishedOf } from './published.js';

const READS = READ_OPERATIONS;

const storedQuery = ({ projectId: _projectId, checkout: _checkout, ...query }: typeof QUERY_WALK.selection.Type): BlockQuery => query;

const BLOCK_READ_ROUTED = {
  search_blocks: routed(READS.search_blocks, {
    ...targeted(
      () => undefined,
      Effect.fnUntraced(function* (input: (typeof READS.search_blocks)['input']['Type'], projectId: number | undefined) {
        const call = yield* yield* GraphCall;
        const narrowed =
          input.query !== undefined ||
          input.tag !== undefined ||
          input.selector !== undefined ||
          input.status !== undefined ||
          input.path !== undefined ||
          input.history !== undefined;
        const recovered = input.cursor === undefined || narrowed ? undefined : yield* walks.recall(SEARCH_WALK, input.cursor);
        return yield* (yield* Ranking).search({
          query: input.query ?? recovered?.query ?? '',
          projectId: projectId ?? call.project.id,
          scopeId: recovered?.scopeId ?? (projectId === undefined || projectId === call.project.id ? call.lens.scope : undefined),
          tag: input.tag ?? recovered?.tag,
          selector: input.selector ?? recovered?.selector,
          status: input.status ?? recovered?.status,
          path: input.path ?? recovered?.path,
          history: input.history ?? recovered?.history,
          cursor: input.cursor,
          limit: input.limit,
        });
      }),
    ),
    answer: (page: SearchPage) => ({
      status: 'ok' as const,
      blocks: page.items,
      total: page.total,
      next: page.nextCursor,
      approximate: page.approximate ? (true as const) : undefined,
    }),
  }),

  query_blocks: routed(READS.query_blocks, {
    ...targeted(
      (input: (typeof READS.query_blocks)['input']['Type']) =>
        input.scope?.[0] ?? input.edge?.from ?? input.edge?.to ?? carriedSelection(QUERY_WALK, input.cursor)?.scope?.[0],
      Effect.fnUntraced(function* (input: (typeof READS.query_blocks)['input']['Type'], selectedProjectId: number | undefined) {
        const call = yield* yield* GraphCall;
        const { cursor, project: _selector, ...rest } = input;
        const narrowed = Object.entries(rest).some(([key, value]) => key !== 'limit' && value !== undefined);
        const recovered = cursor === undefined || narrowed ? undefined : yield* walks.recall(QUERY_WALK, cursor);
        const stored = recovered === undefined ? undefined : storedQuery(recovered);
        const query = stored ?? (rest.sort === undefined ? null : { ...rest, sort: rest.sort });
        if (query === null) {
          if (cursor !== undefined) {
            yield* walks.recall(QUERY_WALK, cursor);
            return yield* cursorRefusal('cursor-stale');
          }
          return yield* new GateRefusal('query-shape', 'a block query names its sort', [
            'name sort as created, updated or ended, with asc or desc order',
            'or hand back only the cursor that the first query answered',
          ]);
        }
        if (narrowed) {
          for (const name of query.scope ?? []) yield* scoped(name);
          if (query.edge?.to !== undefined) yield* scoped(query.edge.to);
          if (query.edge?.from !== undefined) yield* scoped(query.edge.from);
        }
        const targetName = query.scope?.[0] ?? query.edge?.from ?? query.edge?.to;
        const projectId = targetName === undefined ? (selectedProjectId ?? call.project.id) : (yield* scoped(targetName)).projectId;
        const bounded = { ...query, limit: pageRows(rest.limit, BLOCKS, ceilingOf(BLOCKS)) };
        const paged = yield* (yield* Selection).queryPage(projectId, bounded, cursor);
        return { ...paged, sort: query.sort };
      }),
    ),
    answer: (page: QueryPage & { readonly sort: BlockQuery['sort'] }) => ({
      status: 'ok' as const,
      blocks: page.items,
      total: page.total,
      next: page.nextCursor,
      sort: page.sort,
    }),
  }),
};

export const BLOCK_READ_PAIRS = pairsOf(BLOCK_READ_ROUTED);
export const BLOCK_READ_ROUTES = routesOf(BLOCK_READ_ROUTED);

const W = WRITE_OPERATIONS;

const BLOCK_WRITE_ROUTED = {
  create_block: routed(W.create_block, {
    files: (input: (typeof W.create_block)['input']['Type'], caller: Caller) => callerReads(caller, input.bodyFile),
    ...targeted(
      (input: (typeof W.create_block)['input']['Type']) => input.parentId,
      Effect.fnUntraced(function* (input: (typeof W.create_block)['input']['Type'], projectId: number | undefined, caller: Caller) {
        const call = yield* yield* GraphCall;
        const { project: _selector, checkout: _checkout, parentId, edges, amendsId, bodyFile, ...rest } = input;
        const createIn = Effect.fnUntraced(function* (targetProjectId: number, resolvedParentId?: number) {
          const thereBlocks = yield* Blocks;
          const amended = Effect.fn('create_block.amended')(function* (name: string) {
            const row = yield* scoped(name);
            if (row.projectId !== targetProjectId)
              return yield* new GateRefusal('cross-project', 'the amended block is in another project', [
                `name an amended block in project ${targetProjectId}, or create in its project`,
              ]);
            return row.id;
          });
          const linked = yield* Effect.forEach(edges ?? [], (link) =>
            Effect.map(linkTarget(link.to, { projectId: targetProjectId }, link.kind), (target) => ({ kind: link.kind, target })),
          );
          const provenance = {
            parentId: resolvedParentId,
            edges:
              edges === undefined
                ? undefined
                : linked.flatMap((link) => ('near' in link.target ? [{ kind: link.kind, to: link.target.near }] : [])),
            farEdges: linked.flatMap((link) => ('far' in link.target ? [{ kind: link.kind, end: link.target.far }] : [])),
            amendsId: amendsId === undefined ? undefined : yield* amended(amendsId),
          };
          const pricing = yield* birthPricing(targetProjectId, rest.tags, rest.contract);
          return yield* withBodyFile({ body: rest.body, bodyFile: callerPath(caller, bodyFile) }, (body) =>
            Effect.gen(function* () {
              const born: BlockCreate & { readonly farEdges: readonly FarLink[] } = {
                ...rest,
                body,
                projectId: targetProjectId,
                ...provenance,
              };
              return yield* priced(pricing, thereBlocks.create(born));
            }),
          );
        });

        return yield* createIn(projectId ?? call.project.id, parentId === undefined ? undefined : (yield* scoped(parentId)).id);
      }),
    ),
    answer: pricedResult,
  }),

  update_block: routed(W.update_block, {
    files: (input: (typeof W.update_block)['input']['Type'], caller: Caller) => callerReads(caller, input.bodyFile),
    ...targeted(
      (input: (typeof W.update_block)['input']['Type']) => [input.blockId, ...(input.parentId == null ? [] : [input.parentId])],
      Effect.fnUntraced(function* (input: (typeof W.update_block)['input']['Type'], _prepared: number | undefined, caller: Caller) {
        const there = yield* Blocks;
        const row = yield* scoped(input.blockId);
        const across = input.parentId == null ? null : input.parentId;
        if (across !== null && (yield* scoped(across)).projectId !== row.projectId) {
          const changing = (['title', 'body', 'bodyFile', 'status', 'tags', 'fields', 'ord'] as const).filter(
            (key) => input[key] !== undefined,
          );
          if (changing.length > 0) {
            return yield* new GateRefusal(
              'relocation-shape',
              `a move into another graph carries no other change, and this one names ${changing.join(', ')}`,
              [`update_block ${input.blockId} with parentId alone, then update_block with ${changing.join(', ')} in its new graph`],
            );
          }
          const { write, moved } = yield* relocate(input.blockId, across);
          return { value: { ...write, moved }, start: undefined };
        }
        const parentId = input.parentId === undefined ? undefined : across === null ? null : (yield* scoped(across)).id;
        const pricing = yield* nodePricing(row.projectId, { tags: [...row.tags, ...(input.tags ?? [])] });
        return yield* withBodyFile({ body: input.body, bodyFile: callerPath(caller, input.bodyFile) }, (body) =>
          priced(
            pricing,
            there.update({
              id: row.id,
              title: input.title,
              body,
              status: input.status,
              tags: input.tags,
              fields: input.fields,
              parentId,
              ord: input.ord,
            }),
          ),
        );
      }),
    ),
    answer: (raw: Priced<BlockWrite & { readonly moved?: Moved }>) => ({ ...pricedResult(raw), moved: raw.value.moved }),
  }),

  edit_block: routed(W.edit_block, {
    ...targeted(
      (input: (typeof W.edit_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.edit_block)['input']['Type']) {
        return yield* cross(input.blockId, (id) =>
          Effect.gen(function* () {
            const there = yield* Blocks;
            const row = yield* there.rawBlockById(id);
            return yield* priced(
              yield* nodePricing(row.projectId, row),
              there.edit({
                id,
                old: input.oldString,
                new: input.newString,
                all: input.replaceAll,
              }),
            );
          }),
        );
      }),
    ),
    answer: pricedResult,
  }),

  link_blocks: routed(W.link_blocks, {
    ...targeted((input: (typeof W.link_blocks)['input']['Type']) => [input.fromId, input.toId], link),
    answer: () => ({ status: 'ok' as const }),
  }),

  unlink_blocks: routed(W.unlink_blocks, {
    ...targeted((input: (typeof W.unlink_blocks)['input']['Type']) => input.fromId, unlink),
    answer: () => ({ status: 'ok' as const }),
  }),

  set_block_storage: routed(W.set_block_storage, {
    ...targeted(
      (input: (typeof W.set_block_storage)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.set_block_storage)['input']['Type']) {
        const row = yield* scoped(input.blockId);
        const blocks = yield* Blocks;
        const leaving = input.storage === 'stealth' ? [row, ...(yield* blocks.collectDescendants(row.id))] : [];
        const moved = yield* priced(lawPricing(row.projectId, true), blocks.setStorage({ id: row.id, storage: input.storage }));
        return { moved, published: yield* publishedOf(leaving) };
      }),
    ),
    answer: (raw: { readonly moved: Priced<BlockWrite>; readonly published: Published }) => ({
      ...pricedBlockResult(raw.moved),
      ...raw.published,
    }),
  }),

  delete_block: routed(W.delete_block, {
    ...targeted(
      (input: (typeof W.delete_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.delete_block)['input']['Type']) {
        const trash = yield* Trash;
        const row = yield* scoped(input.blockId);
        return yield* priced(lawPricing(row.projectId, true), trash.delete({ id: row.id }));
      }),
    ),
    answer: pricedBlockResult,
  }),

  restore_block: routed(W.restore_block, {
    ...targeted(
      (input: (typeof W.restore_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.restore_block)['input']['Type']) {
        const blockNames = yield* BlockNames;
        const trash = yield* Trash;
        const restoring = yield* blockNames.idOfName(input.blockId);
        const row = yield* (yield* Blocks).rawBlockById(restoring);
        if (row.deletedAt === null) {
          return yield* new GateRefusal('not-in-trash', `${input.blockId} stands in project ${row.projectId}, not in its trash`, [
            `a deleted copy of it in another project's trash is named by that project: restore_block <project id>/${blockName(row.uuid)}`,
          ]);
        }
        const roots = yield* trash.roots(row.projectId);
        if (!roots.some((row) => row.id === restoring)) {
          return yield* new GateRefusal('not-in-trash', `${input.blockId} is not a trash root of this project`, [
            roots.length === 0
              ? 'nothing of this project rests in the trash, so there is no batch to bring back'
              : `restore the ROOT of the batch it fell in: ${roots.map((row) => `${blockName(row.uuid)} ${row.title}`).join(', ')}`,
          ]);
        }
        return yield* priced(lawPricing(row.projectId, true), trash.restore({ id: restoring }));
      }),
    ),
    answer: pricedBlockResult,
  }),
};

export const BLOCK_WRITE_PAIRS = pairsOf(BLOCK_WRITE_ROUTED);
export const BLOCK_WRITE_ROUTES = routesOf(BLOCK_WRITE_ROUTED);
