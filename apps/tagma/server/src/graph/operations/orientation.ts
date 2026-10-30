import { Effect } from 'effect';
import { carriedSelection, pageRows } from '@runlith/paging';
import { EVENTS_WALK } from '../contract/wire/walks.js';
import { BlockNames } from '../contract/service/acts.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Tags } from '../contract/service/vocabulary.js';
import { InstalledCatalogs } from '../contract/service/vocabulary.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { wireRead } from '../reading/rows.js';
import { GraphJournal } from '../contract/service/journal.js';
import { BlockReads } from '../contract/service/reads.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { vocabularyText } from '../voice/tags.js';
import { EVENTS_PAGE_SIZE, EVENTS } from '../contract/wire/operations/shared.js';
import { walks } from '../../platform/contract/wire/refusal.js';
import { pairsOf, routed, routesOf } from '../../platform/contract/service/routed.js';
import { READ_OPERATIONS } from '../contract/wire/operations/reads.js';
import type { BlockRead } from '../contract/wire/rows.js';
import type { InstalledCatalog, Tag } from '../contract/wire/tags/declaration.js';
import type { UnreadableTag } from '../contract/wire/tags/table.js';
import { cross, scoped, targeted } from './crossing.js';
import { CurrentGraph, GraphCall } from '../contract/service/serving.js';
import { departedBlock, journalUnreadable } from '../contract/wire/journalPayloads.js';
import type { GraphAddress } from '../contract/wire/far.js';

const READS = READ_OPERATIONS;

const ORIENTATION_ROUTED = {
  read_tags: routed(READS.read_tags, {
    execute: Effect.fnUntraced(function* () {
      const call = yield* yield* GraphCall;
      const table = yield* (yield* Tags).of(call.project.id);
      const shipped = yield* Catalogs;
      const catalogs = shipped.key === null ? [] : yield* (yield* Settings).value(shipped.key, call.project.id);
      const reader = yield* InstalledCatalogs;
      const installed = yield* reader.read(call.project.id);
      const findings = yield* reader.findings(call.project.id);
      return {
        catalogs,
        installed,
        tags: table.tags,
        unreadable: table.unreadable,
        overview: [
          ...installed.map(
            (catalog) => `Catalog ${catalog.id} [[${catalog.name}]]\n${catalog.guidance}\nTag declarations: ${catalog.tags.join(', ')}`,
          ),
          ...findings.map(
            (finding) =>
              `Finding ${finding.kind}: ${finding.text}${finding.shipped === undefined ? '' : `\nShipped text:\n${finding.shipped}`}`,
          ),
          vocabularyText(table, catalogs),
        ].join('\n\n'),
      };
    }),
    answer: (reading: {
      readonly catalogs: readonly string[];
      readonly installed: readonly InstalledCatalog[];
      readonly tags: readonly Tag[];
      readonly unreadable: readonly UnreadableTag[];
      readonly overview: string;
    }) => ({ status: 'ok' as const, overview: reading.overview }),
  }),

  read_block: routed(READS.read_block, {
    ...targeted(
      (input: (typeof READS.read_block)['input']['Type']) => input.blockIds,
      Effect.fnUntraced(function* (input: (typeof READS.read_block)['input']['Type']) {
        const reads = yield* Effect.forEach(input.blockIds, (name) =>
          cross(name, (id) =>
            Effect.gen(function* () {
              const there = yield* BlockReads;
              return wireRead(yield* there.show(id, input.depth ?? 1, input.includeResting === true));
            }),
          ),
        );
        return { status: 'ok' as const, reads };
      }),
    ),
    answer: (raw: { readonly status: 'ok'; readonly reads: readonly BlockRead[] }) => raw,
  }),

  read_zone: routed(READS.read_zone, {
    ...targeted(
      (input: (typeof READS.read_zone)['input']['Type']) => input.scopeId,
      Effect.fnUntraced(function* (input: (typeof READS.read_zone)['input']['Type']) {
        const call = yield* yield* GraphCall;
        return yield* cross(input.scopeId, (id) =>
          Effect.gen(function* () {
            const there = yield* BlockReads;
            return { status: 'ok' as const, ...(yield* there.zone(id, input.cursor, call.deliveredTags)) };
          }),
        );
      }),
    ),
    answer: (raw: {
      readonly status: 'ok';
      readonly page: string;
      readonly shown: number;
      readonly next: string | null;
      readonly total: number;
      readonly deliveredTags: readonly string[];
    }) => raw,
  }),

  read_events: routed(READS.read_events, {
    ...targeted(
      (input: (typeof READS.read_events)['input']['Type']) => input.blockId ?? carriedSelection(EVENTS_WALK, input.cursor)?.blockId,
      Effect.fnUntraced(function* (input: (typeof READS.read_events)['input']['Type']) {
        const call = yield* yield* GraphCall;
        const blockNames = yield* BlockNames;
        const journal = yield* GraphJournal;
        const sessions = yield* WriterRegister;
        const recovered =
          input.cursor === undefined || input.blockId !== undefined || input.sinceId !== undefined
            ? undefined
            : yield* walks.recall(EVENTS_WALK, input.cursor);
        const blockName = input.blockId ?? recovered?.blockId;
        const sinceId = input.sinceId ?? recovered?.sinceId;
        const block = blockName === undefined ? undefined : yield* scoped(blockName);
        const projectId = block?.projectId ?? call.project.id;
        const cut = yield* walks.page({
          walk: EVENTS_WALK,
          selection: { projectId, checkout: (yield* CurrentGraph)?.checkout ?? null, blockId: blockName, sinceId },
          cursor: input.cursor,
          asked: pageRows(input.limit ?? (sinceId === undefined ? EVENTS_PAGE_SIZE : undefined), EVENTS, ceilingOf(EVENTS)),
          read: (after, rows) =>
            Effect.map(journal.events({ projectId, blockId: block?.id, sinceId, beforeId: after?.[0], limit: rows }), (entries) => ({
              rows: entries,
              total: null,
            })),
          keyOf: (row) => [row.id] as const,
        });
        const named = yield* blockNames.namesOf(cut.rows.flatMap((row) => (row.blockId === null ? [] : [row.blockId])));
        const events = yield* Effect.forEach(cut.rows, (row) =>
          Effect.gen(function* () {
            const writer = yield* sessions.writerOf(row.sessionId);
            const moved = yield* Effect.mapError(Effect.fromResult(departedBlock(row)), journalUnreadable);
            return {
              id: row.id,
              ts: row.ts.toISOString(),
              sessionId: row.sessionId,
              op: row.op,
              blockName: moved?.name ?? (row.blockId === null ? null : (named.get(row.blockId) ?? null)),
              destination: moved?.destination,
              payload: row.payload,
              writer: writer === null ? null : `${writer.harness}:${writer.key}`,
            };
          }),
        );
        return {
          events,
          shown: cut.shown,
          total: cut.total,
          next: cut.next,
          complete: cut.complete,
        };
      }),
    ),
    answer: (reading: {
      readonly events: readonly {
        readonly id: number;
        readonly ts: string;
        readonly sessionId: number | null;
        readonly op: string;
        readonly blockName: string | null;
        readonly destination?: GraphAddress;
        readonly payload: string;
        readonly writer: string | null;
      }[];
      readonly shown: number;
      readonly total: number | null;
      readonly next: string | null;
      readonly complete: boolean;
    }) => ({
      status: 'ok' as const,
      events: reading.events.map(({ id, ts, op, blockName, destination, writer }) => ({
        id,
        at: ts,
        op,
        blockName,
        destination,
        writer,
      })),
      shown: reading.shown,
      total: reading.total,
      next: reading.next,
      complete: reading.complete,
    }),
  }),
};

export const ORIENTATION_PAIRS = pairsOf(ORIENTATION_ROUTED);
export const ORIENTATION_ROUTES = routesOf(ORIENTATION_ROUTED);
