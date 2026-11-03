import { Effect } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, source } from '../store/tables.js';
import { Tags } from '../contract/service/vocabulary.js';
import { carriesTag } from '../vocabulary/projection.js';
import { deliveryOf, type LawReach, type RuleReach } from '../contract/wire/tags/law.js';
import { deriveLaw } from './derived.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { readsThrough } from '../acts/reads.js';
import { insideRelative } from '../sources/readers/place.js';
import { anchorsOf, sourceName } from '../contract/wire/sources.js';

type Anchor = { readonly kind: string; readonly ref: string; readonly symbol: string | null };

export const WHOLE_PROJECT = '';

export const reaches = (places: readonly string[], place: string): boolean =>
  places.some((at) => at === WHOLE_PROJECT || insideRelative(place, at));

export const sourced = (reach: RuleReach): boolean => reach.sources.length > 0;

const placeOf = (ref: string): string => {
  const trimmed = ref.replace(/\/+$/, '');
  return trimmed === '.' ? WHOLE_PROJECT : trimmed;
};

export const lawReach = deriveLaw(
  Effect.fn('Orientation.ruleReach')(function* (projectId: number): Effect.fn.Return<LawReach, StoreFailure, GraphStore | Tags> {
    const { db } = yield* GraphStore;
    const table = yield* (yield* Tags).of(projectId);
    const rules = yield* db
      .select({ id: block.id, tags: block.tags, fields: block.fields })
      .from(block)
      .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), carriesTag(table.lawBearingTypes(), block.id)));
    const placed = new Map<number, Anchor[]>();
    for (let at = 0; at < rules.length; at += 500) {
      for (const row of yield* db
        .select({ blockId: source.blockId, kind: source.kind, ref: source.ref, symbol: source.symbol })
        .from(source)
        .where(
          inArray(
            source.blockId,
            rules.slice(at, at + 500).map((rule) => rule.id),
          ),
        )
        .orderBy(source.id)) {
        placed.set(row.blockId, [...(placed.get(row.blockId) ?? []), row]);
      }
    }
    const reach = new Map<number, RuleReach>();
    for (const rule of rules) {
      const rows = placed.get(rule.id) ?? [];
      reach.set(rule.id, {
        delivery: deliveryOf(table.lawProjection(rule), rule, rows.length > 0),
        sources: rows.map((row) => sourceName(row.ref, row.symbol)),
        places: rows.length === 0 ? [WHOLE_PROJECT] : [...new Set(rows.map((row) => placeOf(row.ref)))],
        anchors: anchorsOf(rows),
      });
    }
    return reach;
  }),
);

export const ruleReach = readsThrough(GraphUnits)(lawReach);
