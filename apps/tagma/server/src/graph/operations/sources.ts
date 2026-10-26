import { GraphScopes } from '../contract/service/serving.js';
import { Effect } from 'effect';
import { page, pageRows } from '@runlith/paging';
import { BlockNames } from '../contract/service/acts.js';
import { GateRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { GAUGES_WALK } from '../contract/wire/walks.js';
import type { WriterRef } from '../../platform/contract/service/writers.js';
import { pairsOf, routed, routesOf } from '../../platform/contract/service/routed.js';
import { SOURCE_OPERATIONS } from '../contract/wire/operations/sources.js';
import { READ_OPERATIONS } from '../contract/wire/operations/reads.js';
import { GAUGES } from '../contract/wire/operations/shared.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Sources, type PlaceSource } from '../contract/service/sources.js';
import { sourceName } from '../sources/readers/place.js';
import { Touches } from '../contract/service/orientation.js';
import { blockName } from '../contract/wire/references.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import { scoped, targeted, peer } from './crossing.js';
import { CurrentGraph, GraphCall } from '../contract/service/serving.js';
import { priced, type Priced } from '../../platform/contract/service/start.js';
import type { StartPrice } from '../../platform/contract/wire/start.js';
import { nodePricing } from './start.js';

const READS = READ_OPERATIONS;

const SOURCE_READ_ROUTED = {
  read_gauges: routed(READS.read_gauges, {
    execute: Effect.fnUntraced(function* (input: (typeof READS.read_gauges)['input']['Type']) {
      const call = yield* yield* GraphCall;
      const path = input.path ?? (input.cursor === undefined ? undefined : (yield* walks.recall(GAUGES_WALK, input.cursor)).path);
      if (path === undefined) {
        return yield* new GateRefusal('not-found', 'the gauge read names a path or continues one', [
          'name one project-relative path',
          'or hand back the cursor the previous gauge page answered',
        ]);
      }
      const resumed = yield* walks.resume(
        GAUGES_WALK,
        { projectId: call.project.id, checkout: (yield* CurrentGraph)?.checkout ?? null, path },
        input.cursor,
      );
      const { place } = yield* (yield* GraphScopes).placeOf(call.project.id, path);
      const asked = pageRows(input.limit, GAUGES, ceilingOf(GAUGES));
      const slice = yield* (yield* Sources).atPlacePage(call.project.id, place, resumed.after, asked + 1);
      const cut = page({
        rows: slice.rows,
        asked,
        keyOf: (row) => [row.source.symbol ?? '', row.block.id, row.source.id],
        question: resumed.question,
        total: slice.total,
      });
      const table = yield* (yield* Tags).of(call.project.id);
      return {
        place,
        gauges: cut.rows,
        labels: cut.rows.map(
          (row) =>
            `${blockName(row.block.uuid)} [${tagLabel(table.tagOf(row.block))}] ${row.block.title} · ${sourceName(row.source.ref, row.source.symbol)} · area ${row.area.title}`,
        ),
        shown: cut.shown,
        total: cut.total,
        next: cut.next,
        complete: cut.complete,
        touches: (yield* (yield* Touches).of({ projectId: call.project.id, place })).map((row) => ({
          writer: row.writer,
          task: { name: row.task.name, title: row.task.title },
          wrote: row.wrote,
        })),
      };
    }),
    answer: (reading: {
      readonly place: string;
      readonly gauges: readonly PlaceSource[];
      readonly labels: readonly string[];
      readonly shown: number;
      readonly total: number;
      readonly next: string | null;
      readonly complete: boolean;
      readonly touches: readonly {
        readonly writer: WriterRef;
        readonly task: { readonly name: string; readonly title: string };
        readonly wrote: boolean;
      }[];
    }) => ({
      status: 'ok' as const,
      gauges: reading.labels,
      shown: reading.shown,
      total: reading.total,
      next: reading.next,
      complete: reading.complete,
    }),
  }),
};

export const SOURCE_READ_PAIRS = pairsOf(SOURCE_READ_ROUTED);
export const SOURCE_READ_ROUTES = routesOf(SOURCE_READ_ROUTED);

const M = SOURCE_OPERATIONS;

const SOURCE_ROUTED = {
  anchor_block: routed(M.anchor_block, {
    ...targeted(
      (input: (typeof M.anchor_block)['input']['Type']) => [input.blockId, ...(input.fromId === undefined ? [] : [input.fromId])],
      Effect.fnUntraced(function* (input: (typeof M.anchor_block)['input']['Type']) {
        const row = yield* scoped(input.blockId);
        const donor = input.fromId === undefined ? undefined : yield* peer(input.fromId, row, 'source-outside');
        return yield* priced(
          yield* nodePricing(row.projectId, row, true),
          (yield* Sources).attach({
            blockId: row.id,
            kind: input.kind ?? (input.symbol === undefined ? 'file' : 'symbol'),
            ref: input.ref,
            symbol: input.symbol,
            fromId: donor?.id,
          }),
        );
      }),
    ),
    answer: ({ value: row, start }: Priced<Effect.Success<ReturnType<Sources['Service']['attach']>>>) => ({
      status: 'ok' as const,
      source: { id: row.id, kind: row.kind, ref: row.ref, symbol: row.symbol },
      start,
    }),
  }),

  unanchor_block: routed(M.unanchor_block, {
    ...targeted(
      (input: (typeof M.unanchor_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof M.unanchor_block)['input']['Type']) {
        const row = yield* scoped(input.blockId);
        const { start } = yield* priced(
          yield* nodePricing(row.projectId, row, true),
          (yield* Sources).unanchor({
            blockId: yield* (yield* BlockNames).idOfName(input.blockId),
            kind: input.kind ?? (input.symbol === undefined ? 'file' : 'symbol'),
            ref: input.ref,
            symbol: input.symbol,
          }),
        );
        return { status: 'ok' as const, start };
      }),
    ),
    answer: (raw: { readonly status: 'ok'; readonly start: StartPrice | undefined }) => raw,
  }),

  reanchor_path: routed(M.reanchor_path, {
    execute: Effect.fnUntraced(function* (input: (typeof M.reanchor_path)['input']['Type'], _prepared: undefined) {
      const call = yield* yield* GraphCall;
      const act = yield* BlockNames;
      const moved = yield* (yield* Sources).relocate({
        projectId: call.project.id,
        from: input.from,
        to: input.to,
      });
      return yield* Effect.forEach(moved, (row) =>
        Effect.map(act.nameOf(row.blockId), (blockName) => ({ blockName, from: row.from, to: row.to })),
      );
    }),
    answer: (rows: ReadonlyArray<{ readonly blockName: string; readonly from: string; readonly to: string }>, input) => ({
      status: 'ok' as const,
      overview:
        rows.length === 0 ? `no source stands on ${input.from}` : rows.map((row) => `${row.blockName} ${row.from} → ${row.to}`).join('\n'),
    }),
  }),
};

export const SOURCE_PAIRS = pairsOf(SOURCE_ROUTED);
export const SOURCE_ROUTES = routesOf(SOURCE_ROUTED);
