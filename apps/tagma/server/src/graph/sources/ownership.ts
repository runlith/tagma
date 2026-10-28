import { Effect } from 'effect';
import type { SourceKind } from '../contract/wire/sources.js';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { block, source, SOURCE_PLACE_INDEX } from '../store/tables.js';
import { depthOf } from './readers/place.js';
import { blockName } from '../contract/wire/references.js';
import { CONTAINER } from '../contract/wire/tags/container.js';
import { rests } from '../contract/wire/standing.js';
import type { PlacePosition, PlaceSource } from '../contract/service/sources.js';
import type { SourceParts } from './reads.js';

type OwnerSource = { readonly blockId: number; readonly kind: SourceKind; readonly ref: string };

export const sourceOwnership = (parts: SourceParts) => {
  const { db, blockRows, scopes, vocabulary } = parts;

  const ancestry = Effect.fn('Sources.ancestry')(function* (projectId: number, blockIds: readonly number[]) {
    const table = yield* vocabulary.of(projectId);
    const chain =
      blockIds.length === 0
        ? []
        : yield* db.all<{ id: number }>(sql`
          with recursive up(id, parent_id) as (
            select ${block.id}, ${block.parentId} from ${block} where ${inArray(block.id, [...blockIds])} and ${block.deletedAt} is null
            union
            select p.id, p.parent_id from ${block} p join up on p.id = up.parent_id where p.deleted_at is null
          )
          select id from up`);
    const rows =
      chain.length === 0
        ? []
        : yield* db
            .select({ id: block.id, uuid: block.uuid, parentId: block.parentId, tags: block.tags, title: block.title })
            .from(block)
            .where(
              and(
                eq(block.projectId, projectId),
                inArray(
                  block.id,
                  chain.map((row) => row.id),
                ),
              ),
            );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return (blockId: number) => {
      let cursor = byId.get(blockId);
      while (cursor !== undefined && !table.supports(cursor, CONTAINER) && cursor.parentId !== null) cursor = byId.get(cursor.parentId);
      return cursor === undefined
        ? { id: blockId, name: '', title: '' }
        : { id: cursor.id, name: blockName(cursor.uuid), title: cursor.title };
    };
  });

  const atPlacePage = Effect.fn('Sources.atPlacePage')(function* (
    projectId: number,
    at: string,
    after: PlacePosition | undefined,
    rows: number,
  ) {
    const placed = and(eq(block.projectId, projectId), isNull(block.deletedAt), eq(source.ref, at));
    const symbol = sql`coalesce(${source.symbol}, '')`;
    const past =
      after === undefined
        ? undefined
        : sql`(${symbol} > ${after[0]} or (${symbol} = ${after[0]} and (${block.id} > ${after[1]} or (${block.id} = ${after[1]} and ${source.id} > ${after[2]}))))`;
    const found = yield* db
      .select({ source, block })
      .from(source)
      .innerJoin(block, eq(block.id, source.blockId))
      .where(and(placed, past))
      .orderBy(symbol, block.id, source.id)
      .limit(rows);
    const counted = yield* db
      .select({ total: sql<number>`count(*)` })
      .from(source)
      .innerJoin(block, eq(block.id, source.blockId))
      .where(placed)
      .get();
    if (counted === undefined) return yield* Effect.die('gauge count returned no row');
    const areaOf = yield* ancestry(
      projectId,
      found.map((row) => row.block.id),
    );
    const records = new Map((yield* blockRows.details(found.map((row) => row.block))).map((row) => [row.id, row]));
    const page: PlaceSource[] = [];
    for (const row of found) {
      const record = records.get(row.block.id);
      if (!record) return yield* Effect.die(`record projection lost ${blockName(row.block.uuid)}`);
      page.push({ source: row.source, block: record, area: areaOf(row.block.id) });
    }
    return { rows: page, total: counted.total };
  });

  const covering = Effect.fnUntraced(function* (projectId: number, spelling: string, containers: boolean, excluding?: number) {
    const { place, symbol } = yield* scopes.placeOf(projectId, spelling);
    const ancestors = new Set(['.', place]);
    for (let at = place.lastIndexOf('/'); at > 0; at = place.lastIndexOf('/', at - 1)) ancestors.add(place.slice(0, at));
    const matching = and(
      eq(block.projectId, projectId),
      isNull(block.deletedAt),
      excluding === undefined ? undefined : ne(block.id, excluding),
      inArray(source.ref, [...ancestors]),
      or(
        eq(source.kind, 'dir'),
        and(eq(source.kind, 'file'), eq(source.ref, place)),
        symbol === undefined ? sql`0` : and(eq(source.kind, 'symbol'), eq(source.ref, place), eq(source.symbol, symbol)),
      ),
    );
    const rows = yield* db.all<OwnerSource>(sql`
      select ${source.blockId} as blockId, ${source.kind} as kind, ${source.ref} as ref
      from ${source} indexed by ${sql.identifier(SOURCE_PLACE_INDEX)}
      cross join ${block} on ${block.id} = ${source.blockId}
      where ${matching}`);
    if (rows.length === 0) return [];
    const table = yield* vocabulary.of(projectId);
    const candidates = yield* blockRows.details(
      yield* db
        .select()
        .from(block)
        .where(
          and(inArray(block.id, [...new Set(rows.map((row) => row.blockId))]), eq(block.projectId, projectId), isNull(block.deletedAt)),
        ),
    );
    const standing = new Set(
      candidates.flatMap((row) => (rests(table, row) || (containers && !table.supports(row, CONTAINER)) ? [] : [row.id])),
    );
    let best = 0;
    let depth = -1;
    const owners = new Set<number>();
    for (const row of rows) {
      if (!standing.has(row.blockId)) continue;
      const reach = row.kind === 'symbol' ? 3 : row.kind === 'dir' ? 1 : 2;
      const deep = row.kind === 'dir' ? depthOf(row.ref) : 0;
      if (reach > best || (reach === best && deep > depth)) {
        best = reach;
        depth = deep;
        owners.clear();
      }
      if (reach === best && deep === depth) owners.add(row.blockId);
    }
    return candidates.filter((row) => owners.has(row.id));
  });

  const ownersOf = Effect.fn('Sources.ownersOf')(function* (projectId: number, spelling: string, excluding?: number) {
    return yield* covering(projectId, spelling, false, excluding);
  });

  const containersOf = Effect.fn('Sources.containersOf')(function* (projectId: number, spelling: string) {
    return yield* covering(projectId, spelling, true);
  });

  return { atPlacePage, ownersOf, containersOf };
};
