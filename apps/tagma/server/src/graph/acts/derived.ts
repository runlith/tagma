import { Effect, Fiber } from 'effect';
import { aliasedTable, and, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';
import { blockIdentity, blockName, blockRefTargets } from '../contract/wire/references.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { source, block, blockField, blockTag, meta, spokenTail, ref, searchIndex } from '../store/tables.js';
import { ActState } from '../contract/service/transaction.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import type { Tags } from '../contract/service/vocabulary.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { projectedFields, projectedTags, storedTypeId } from '../vocabulary/projection.js';
import { phaseWordsStand, publishPhaseWords } from '../vocabulary/phaseWords.js';
import { type SearchRow, searchProjectionOf } from '../search/words.js';
import { countSearch } from '../search/counting.js';
import { type Act, type DerivedFact, BlockProjection, BlockReferences } from '../contract/service/acts.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting, referencing } from '../store/actWrites.js';

const VOCABULARY: readonly string[] = [TAG_DECLARATION.id, CATALOG_DECLARATION.id];
const shapesVocabulary = (row: { readonly tags: readonly string[] }): boolean => row.tags.some((tag) => VOCABULARY.includes(tag));

const completing = writes('BlockProjection.completeDerived', [], projecting, referencing);

const EVERY_FACT: readonly DerivedFact[] = ['refs', 'search', 'tags'];

const REF_COLUMNS = Object.keys(getTableColumns(ref)).length;
const SEARCH_COLUMNS = Object.keys(getTableColumns(searchIndex)).length;
const TAG_COLUMNS = Object.keys(getTableColumns(blockTag)).length;
const FIELD_COLUMNS = Object.keys(getTableColumns(blockField)).length;

type Db = GraphStore['Service']['db'];

type Candidate = { readonly id: number; readonly uuid: string };

type Referring = { readonly id: number; readonly names: readonly string[] };

type Tagged = {
  readonly id: number;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
};

type Derivable = Tagged & { readonly projectId: number; readonly title: string; readonly body: string; readonly size: number };

const SIZE = sql<number>`length(${block.title}) + length(${block.body}) + length(${block.fields})`.mapWith(Number);

function referredIds(names: readonly string[], byTail: ReadonlyMap<string, readonly Candidate[]>): number[] {
  const targets = new Set<number>();
  for (const name of names) {
    const hit = (byTail.get(name.slice(-SPOKEN_LENGTH)) ?? []).filter((row) => row.uuid.replaceAll('-', '').endsWith(name));
    if (hit.length === 1 && hit[0] !== undefined) targets.add(hit[0].id);
  }
  return [...targets];
}

const writeRefs = Effect.fnUntraced(function* (db: Db, projectId: number, rows: readonly Referring[]) {
  const named = rows.filter((row) => row.names.length > 0);
  if (named.length === 0) return;
  const tails = [...new Set(named.flatMap((row) => row.names.map((name) => name.slice(-SPOKEN_LENGTH))))];
  const byTail = new Map<string, Candidate[]>();
  for (const page of pagesOf(tails, 2)) {
    const candidates = yield* db
      .select({ id: block.id, uuid: block.uuid, tail: spokenTail })
      .from(block)
      .where(and(eq(block.projectId, projectId), inArray(spokenTail, page)));
    for (const candidate of candidates) {
      const tail = String(candidate.tail);
      const known = byTail.get(tail);
      if (known === undefined) byTail.set(tail, [candidate]);
      else known.push(candidate);
    }
  }
  const refs = named.flatMap((row) => referredIds(row.names, byTail).map((toId) => ({ fromId: row.id, toId })));
  for (const page of pagesOf(refs, REF_COLUMNS)) yield* db.insert(ref).values(page);
});

const writeSearch = Effect.fnUntraced(function* (db: Db, rows: readonly SearchRow[]) {
  for (const page of pagesOf(rows, SEARCH_COLUMNS, (row) => row.titleText.length + row.text.length)) {
    yield* db
      .insert(searchIndex)
      .values(page)
      .onConflictDoUpdate({
        target: searchIndex.blockId,
        set: { titleText: sql`excluded.title_text`, text: sql`excluded.text` },
      });
  }
});

const declare = Effect.fnUntraced(function* (db: Db, tags: Tags['Service'], projectId: number, rows: readonly Tagged[], stood: boolean) {
  const declaring = rows.filter(shapesVocabulary);
  if (declaring.length > 0 || stood) {
    const declared = declaring.flatMap((row) => projectedTags(row).map((tag) => ({ blockId: row.id, tag })));
    for (const page of pagesOf(declared, TAG_COLUMNS, (row) => row.tag.length)) yield* db.insert(blockTag).values(page);
    yield* tags.forget(projectId);
  }
  return yield* tags.of(projectId);
});

const writeCarried = Effect.fnUntraced(function* (db: Db, table: TagTable, rows: readonly Tagged[]) {
  const carried = rows
    .filter((row) => !shapesVocabulary(row))
    .flatMap((row) => projectedTags(row).map((tag) => ({ blockId: row.id, tag, typeId: storedTypeId(table, tag) })));
  for (const page of pagesOf(carried, TAG_COLUMNS, (row) => row.tag.length)) yield* db.insert(blockTag).values(page);
  const fields = rows.flatMap((row) => projectedFields(table, row).map((field) => ({ blockId: row.id, ...field })));
  for (const page of pagesOf(fields, FIELD_COLUMNS, (row) => row.value.length)) yield* db.insert(blockField).values(page);
});

const writeTags = Effect.fnUntraced(function* (db: Db, tags: Tags['Service'], projectId: number, rows: readonly Tagged[], stood: boolean) {
  yield* writeCarried(db, yield* declare(db, tags, projectId, rows, stood), rows);
});

const dropRefs = Effect.fnUntraced(function* (db: Db, ids: readonly number[]) {
  for (const page of pagesOf(ids, 1)) yield* db.delete(ref).where(inArray(ref.fromId, page));
});

const dropTags = Effect.fnUntraced(function* (db: Db, ids: readonly number[]) {
  const stood: number[] = [];
  for (const page of pagesOf(ids, 1)) {
    const gone = yield* db
      .delete(blockTag)
      .where(inArray(blockTag.blockId, page))
      .returning({ blockId: blockTag.blockId, tag: blockTag.tag });
    for (const row of gone) if (VOCABULARY.includes(row.tag)) stood.push(row.blockId);
    yield* db.delete(blockField).where(inArray(blockField.blockId, page));
  }
  return new Set(stood);
});

const sourceRefsOf = Effect.fnUntraced(function* (db: Db, ids: readonly number[]) {
  const refs = new Map<number, string[]>();
  for (const page of pagesOf(ids, 1)) {
    const rows = yield* db
      .select({ blockId: source.blockId, ref: source.ref, symbol: source.symbol })
      .from(source)
      .where(inArray(source.blockId, page))
      .orderBy(source.blockId, source.id);
    for (const row of rows) {
      const spelled = row.symbol ? `${row.ref}#${row.symbol}` : row.ref;
      const known = refs.get(row.blockId);
      if (known === undefined) refs.set(row.blockId, [spelled]);
      else known.push(spelled);
    }
  }
  return refs;
});

const readDerivable = Effect.fnUntraced(function* (db: Db, ids: readonly number[]) {
  const sized: { readonly id: number; readonly size: number }[] = [];
  for (const page of pagesOf(ids, 1)) {
    sized.push(...(yield* db.select({ id: block.id, size: SIZE }).from(block).where(inArray(block.id, page))));
  }
  const rows: Derivable[] = [];
  for (const page of pagesOf(sized, 1, (row) => row.size)) {
    rows.push(
      ...(yield* db
        .select({
          id: block.id,
          projectId: block.projectId,
          title: block.title,
          body: block.body,
          tags: block.tags,
          fields: block.fields,
          size: SIZE,
        })
        .from(block)
        .where(
          inArray(
            block.id,
            page.map((row) => row.id),
          ),
        )),
    );
  }
  return rows;
});

export function blockReferences(db: Db): BlockReferences['Service'] {
  const refsIn = Effect.fn('Act.refsIn')(function* (id: number) {
    const rows = yield* db
      .select({ uuid: block.uuid })
      .from(ref)
      .innerJoin(block, eq(block.id, ref.fromId))
      .where(and(eq(ref.toId, id), isNull(block.deletedAt)));
    return rows.map((item) => blockName(item.uuid));
  });

  const syncRefs: BlockReferences['Service']['syncRefs'] = Effect.fn('Act.syncRefs')(function* (
    blockId: number,
    body: string,
    born?: { readonly projectId: number },
  ) {
    yield* ActState;
    if (born === undefined) yield* dropRefs(db, [blockId]);
    const names = blockRefTargets(body);
    if (names.length === 0) return;
    const owner = born ?? (yield* db.select({ projectId: block.projectId }).from(block).where(eq(block.id, blockId)).get());
    if (owner === undefined) return;
    yield* writeRefs(db, owner.projectId, [{ id: blockId, names }]);
  });

  return BlockReferences.of({
    refsIn,
    syncRefs,
    refsOf: (projectId: number, within?: ReadonlySet<number>) => {
      const target = aliasedTable(block, 'refTarget');
      return db
        .select({ from: block.uuid, to: target.uuid, fromRowKey: ref.fromId, toRowKey: ref.toId })
        .from(ref)
        .innerJoin(block, eq(block.id, ref.fromId))
        .innerJoin(target, eq(target.id, ref.toId))
        .where(
          and(
            eq(block.projectId, projectId),
            isNull(block.deletedAt),
            isNull(target.deletedAt),
            ...(within === undefined ? [] : [or(inArray(ref.fromId, [...within]), inArray(ref.toId, [...within]))]),
          ),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              fromName: blockName(row.from),
              toName: blockName(row.to),
              fromIdentity: blockIdentity(row.from),
              toIdentity: blockIdentity(row.to),
              fromRowKey: row.fromRowKey,
              toRowKey: row.toRowKey,
            })),
          ),
        );
    },
  });
}

export function blockProjection(db: Db, tags: Tags['Service'], unit: Act['Service']['unit']): BlockProjection['Service'] {
  const syncSearch: BlockProjection['Service']['syncSearch'] = Effect.fn('Act.syncSearch')(function* (blockId: number) {
    yield* ActState;
    const row = yield* db.select({ title: block.title, body: block.body }).from(block).where(eq(block.id, blockId)).get();
    if (!row) return;
    const refs = yield* sourceRefsOf(db, [blockId]);
    yield* writeSearch(db, [{ blockId, ...searchProjectionOf(row.title, row.body, refs.get(blockId) ?? []) }]);
  });

  const syncTags: BlockProjection['Service']['syncTags'] = Effect.fn('Act.syncTags')(function* (blockId: number) {
    yield* ActState;
    const row = yield* db
      .select({ id: block.id, tags: block.tags, fields: block.fields, projectId: block.projectId })
      .from(block)
      .where(eq(block.id, blockId))
      .get();
    const stood = yield* dropTags(db, [blockId]);
    if (!row) return;
    yield* writeTags(db, tags, row.projectId, [row], stood.size > 0);
  });

  const syncBorn: BlockProjection['Service']['syncBorn'] = Effect.fn('Act.syncBorn')(function* (row, search: boolean) {
    yield* ActState;
    if (search) yield* writeSearch(db, [{ blockId: row.id, ...searchProjectionOf(row.title, row.body, []) }]);
    yield* writeTags(db, tags, row.projectId, [row], false);
  });

  const derive: BlockProjection['Service']['derive'] = Effect.fn('BlockProjection.derive')(function* (blockIds, facts = EVERY_FACT) {
    yield* ActState;
    if (blockIds.length === 0) return;
    const rows = yield* readDerivable(db, blockIds);
    const refs = facts.includes('search')
      ? yield* sourceRefsOf(
          db,
          rows.map((row) => row.id),
        )
      : new Map<number, string[]>();
    const counting = facts.includes('search')
      ? yield* Effect.forkChild(
          countSearch(rows.map((row) => ({ id: row.id, title: row.title, body: row.body, sourceRefs: refs.get(row.id) ?? [] }))),
        )
      : undefined;
    const writing = Effect.gen(function* () {
      if (facts.includes('refs')) yield* dropRefs(db, blockIds);
      const stood = facts.includes('tags') ? yield* dropTags(db, blockIds) : new Set<number>();
      const projects = new Map<number, Derivable[]>();
      for (const row of rows) {
        const owned = projects.get(row.projectId);
        if (owned === undefined) projects.set(row.projectId, [row]);
        else owned.push(row);
      }
      for (const [projectId, owned] of projects) {
        const table = facts.includes('tags')
          ? yield* declare(
              db,
              tags,
              projectId,
              owned,
              owned.some((row) => stood.has(row.id)),
            )
          : undefined;
        for (const page of pagesOf(owned, 1, (row) => row.size)) {
          if (table !== undefined) yield* writeCarried(db, table, page);
          if (facts.includes('refs')) {
            yield* writeRefs(
              db,
              projectId,
              page.map((row) => ({ id: row.id, names: blockRefTargets(row.body) })),
            );
          }
        }
      }
    });
    if (counting === undefined) return yield* writing;
    yield* writing.pipe(Effect.onError(() => Fiber.interrupt(counting)));
    yield* writeSearch(db, yield* Fiber.join(counting));
  });

  const discard: BlockProjection['Service']['discard'] = Effect.fn('BlockProjection.discard')(function* (blockIds) {
    yield* ActState;
    if (blockIds === undefined) {
      const declaring = yield* db
        .selectDistinct({ projectId: block.projectId })
        .from(block)
        .innerJoin(blockTag, eq(blockTag.blockId, block.id))
        .where(inArray(blockTag.tag, [...VOCABULARY]));
      yield* db.delete(ref);
      yield* db.delete(searchIndex);
      yield* db.delete(blockTag);
      yield* db.delete(blockField);
      for (const row of declaring) yield* tags.forget(row.projectId);
      return;
    }
    if (blockIds.length === 0) return;
    yield* dropRefs(db, blockIds);
    const stood = yield* dropTags(db, blockIds);
    for (const page of pagesOf(blockIds, 1)) yield* db.delete(searchIndex).where(inArray(searchIndex.blockId, page));
    if (stood.size === 0) return;
    const declaring = yield* db
      .selectDistinct({ projectId: block.projectId })
      .from(block)
      .where(inArray(block.id, [...stood]));
    for (const row of declaring) yield* tags.forget(row.projectId);
  });

  const forgetVocabulary: BlockProjection['Service']['forgetVocabulary'] = Effect.fn('Act.forgetVocabulary')(function* (
    blockIds: readonly number[],
  ) {
    if (blockIds.length === 0) return;
    yield* ActState;
    const declaring = yield* db
      .selectDistinct({ projectId: block.projectId })
      .from(block)
      .innerJoin(blockTag, eq(blockTag.blockId, block.id))
      .where(and(inArray(block.id, [...blockIds]), inArray(blockTag.tag, [...VOCABULARY])));
    for (const row of declaring) yield* tags.forget(row.projectId);
  });

  return BlockProjection.of({
    completeDerived: (scope = 'all') =>
      unit(
        completing,
        Effect.gen(function* () {
          const pending = yield* db.select({ key: meta.key }).from(meta).where(eq(meta.key, 'type-index-pending')).get();
          const projects = yield* db.selectDistinct({ projectId: block.projectId }).from(block);
          if (pending !== undefined) {
            for (const { projectId } of projects) yield* tags.forget(projectId);
            yield* db.delete(meta).where(eq(meta.key, pending.key));
          }
          for (const { projectId } of projects) {
            if (!(yield* phaseWordsStand(db, projectId))) yield* publishPhaseWords(db, yield* tags.of(projectId), projectId);
          }
          const lost = (yield* db
            .select({ id: block.id })
            .from(block)
            .leftJoin(searchIndex, eq(searchIndex.blockId, block.id))
            .where(isNull(searchIndex.blockId))).map((row) => row.id);
          yield* derive(lost, scope === 'types' ? ['search'] : EVERY_FACT);
        }),
      ),
    derive,
    discard,
    syncSearch,
    syncTags,
    syncBorn,
    forgetVocabulary,
  });
}
