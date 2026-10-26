import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Act, BlockProjection } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { MODULE } from '../contract/wire/tags/moduleContract.js';
import { block, source } from '../store/tables.js';
import { placing } from '../store/actWrites.js';
import { carriesContract, carriesTag } from '../vocabulary/projection.js';
import { insideRelative } from '../sources/readers/place.js';

const stepping = writes('Tree.step.ruleDelivery', [block, source], placing);

type Placed = { readonly kind: 'dir' | 'file'; readonly ref: string };

const WHOLE = '.';

const outermost = (places: readonly Placed[]): Placed[] => {
  const unique = [...new Map(places.map((one) => [one.ref, one])).values()].sort((a, b) => a.ref.localeCompare(b.ref));
  return unique.filter((one) => !unique.some((other) => other !== one && other.kind === 'dir' && insideRelative(one.ref, other.ref)));
};

export const ruleDelivery = Effect.fn('GraphStep.ruleDelivery')(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const table = yield* (yield* Tags).of(project.id);
  const live = and(eq(block.projectId, project.id), isNull(block.deletedAt));
  const ruleRows = yield* db
    .select({ id: block.id, tags: block.tags, fields: block.fields })
    .from(block)
    .where(and(live, carriesTag(table.lawBearingTypes(), block.id)));
  if (ruleRows.length === 0) return;
  const rules = ruleRows.map((row) => row.id);
  const enforced = new Set(
    ruleRows.flatMap((row) => {
      const field = table.lawProjection(row)?.enforcement?.field;
      return field !== undefined && row.fields[field] !== undefined ? [row.id] : [];
    }),
  );
  const modules = new Set(
    (yield* db
      .select({ id: block.id })
      .from(block)
      .where(and(live, carriesContract(table, MODULE, block.id)))).map((row) => row.id),
  );
  const parents = new Map(
    (yield* db.select({ id: block.id, parentId: block.parentId }).from(block).where(eq(block.projectId, project.id))).map(
      (row) => [row.id, row.parentId] as const,
    ),
  );
  const owners = [...new Set([...rules, ...modules])];
  const placed = new Map<number, Placed[]>();
  const symbolic = new Set<number>();
  for (let at = 0; at < owners.length; at += 500) {
    for (const row of yield* db
      .select({ blockId: source.blockId, kind: source.kind, ref: source.ref })
      .from(source)
      .where(inArray(source.blockId, owners.slice(at, at + 500)))) {
      if (row.kind === 'symbol') symbolic.add(row.blockId);
      else placed.set(row.blockId, [...(placed.get(row.blockId) ?? []), { kind: row.kind, ref: row.ref.replace(/\/+$/, '') }]);
    }
  }
  const moduleAbove = (id: number): number | null => {
    for (let at = parents.get(id) ?? null; at !== null; at = parents.get(at) ?? null) if (modules.has(at)) return at;
    return null;
  };
  const territory = new Map<number, Placed[]>([...modules].map((id) => [id, [...(placed.get(id) ?? [])]]));
  for (const id of modules) {
    for (let above = moduleAbove(id); above !== null; above = moduleAbove(above)) territory.get(above)?.push(...(placed.get(id) ?? []));
  }
  const anchored = rules.flatMap((id) => {
    if ((placed.get(id) ?? []).length > 0) return [];
    const module = moduleAbove(id);
    if (module === null) return enforced.has(id) && symbolic.has(id) ? [{ id, drawn: [{ kind: 'dir', ref: WHOLE } satisfies Placed] }] : [];
    const drawn = outermost(territory.get(module) ?? []);
    return drawn.length === 0 ? [] : [{ id, drawn }];
  });
  if (anchored.length === 0) return;
  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const { id, drawn } of anchored) {
        for (const one of drawn) {
          yield* db
            .insert(source)
            .values({ blockId: id, kind: one.kind, ref: one.ref, symbol: null, createdAt: now })
            .onConflictDoNothing();
          yield* act.record('anchor', id, { path: one.ref, kind: one.kind }, now);
        }
        yield* projection.syncSearch(id);
      }
    }),
  );
});
