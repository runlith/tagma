import { Effect } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { pagesOf } from '../../platform/store/binds.js';
import type { ActEntry, BlockNames } from '../contract/service/acts.js';
import { ServedStorage } from '../contract/service/serving.js';
import type { Tags } from '../contract/service/vocabulary.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { blockName } from '../contract/wire/references.js';
import { MODULE } from '../contract/wire/tags/moduleContract.js';
import { TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { blocksOf } from '../journal/eventLog.js';
import { readJournal } from '../contract/wire/journalPayloads.js';
import { block, blockTag, edge, ref } from '../store/tables.js';
import { declaringTag, readFieldOption } from '../vocabulary/declarationRules.js';

type Row = typeof block.$inferSelect;

type Crossing = { readonly team: string; readonly stealth: string; readonly via: string };

type Named = { readonly row: Row; readonly field: string; readonly name: string };

const NAMED = 6;

const parent = alias(block, 'parent');

const pages = (ids: readonly number[]) => pagesOf(ids, 1);

const spoken = (name: string): string => name.toLowerCase().replaceAll('-', '');

const fieldNames = Effect.fnUntraced(function* (table: TagTable, rows: readonly Row[]) {
  const named: Named[] = [];
  for (const row of rows) {
    const tags = table.tagsOf(row);
    for (const [field, value] of Object.entries(row.fields)) {
      const declared = declaringTag(tags, field)?.fields[field];
      if (declared === undefined || typeof declared === 'string' || declared.type !== 'ref') continue;
      for (const one of Array.isArray(value) ? (value as readonly unknown[]) : [value]) {
        if (typeof one === 'string') named.push({ row, field, name: spoken(one) });
      }
    }
    const enforcement = table.lawProjection(row)?.enforcement?.field;
    if (enforcement === undefined) continue;
    const document = yield* readFieldOption(row, enforcement, 'lawEnforcement').pipe(
      Effect.catchIf(
        (refused): refused is GateRefusal<'field-invalid'> => refused.code === 'field-invalid',
        () => Effect.succeed(undefined),
      ),
    );
    for (const debt of document?.debt ?? []) named.push({ row, field: enforcement, name: spoken(debt.owner) });
  }
  return named;
});

const holderTags = (table: TagTable): readonly string[] =>
  table.tags.flatMap((tag) =>
    Object.values(tag.fields).some(
      (field) => typeof field !== 'string' && (field.type === 'ref' || (field.type === 'schema' && field.name === 'lawEnforcement')),
    )
      ? [tag.id]
      : [],
  );

const dependency = (crossings: readonly Crossing[]) =>
  new GateRefusal(
    'stealth-dependency',
    `a team block would depend on a stealth block, and a clone of the repository would read it broken: ${crossings
      .slice(0, NAMED)
      .map((one) => `${one.team} → ${one.stealth} (${one.via})`)
      .join('; ')}${crossings.length > NAMED ? `; +${crossings.length - NAMED}` : ''}`,
    [
      `set_block_storage ${crossings[0]?.team ?? '<team block>'} stealth — the dependent block goes stealth too`,
      `set_block_storage ${crossings[0]?.stealth ?? '<stealth block>'} team — publish what it depends on`,
      'drop the dependency — unlink the edge, edit the reference or the field — in the same apply_batch as the move',
    ],
  );

export const judgeLayers = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  tags: Tags['Service'],
  names: BlockNames['Service'],
  recorded: readonly ActEntry[],
): Effect.fn.Return<void, StoreFailure | GateRefusal<'stealth-dependency' | 'stealth-supersede' | 'stealth-module'>> {
  const storage = yield* ServedStorage;
  if (storage?.mode !== 'team' || storage.stealth === null || storage.stealth.tree() === null) return;
  const ids = [...new Set(recorded.flatMap((entry) => blocksOf(entry).ids))];
  if (ids.length === 0) return;
  const touched: Row[] = [];
  for (const page of pages(ids))
    touched.push(
      ...(yield* db
        .select()
        .from(block)
        .where(and(inArray(block.id, page), isNull(block.deletedAt)))),
    );
  for (const projectId of new Set(touched.map((row) => row.projectId))) {
    const kept = yield* db
      .select({ id: block.id })
      .from(block)
      .where(and(eq(block.projectId, projectId), eq(block.stealth, true), isNull(block.deletedAt)))
      .limit(1);
    if (kept.length === 0) continue;
    const table = yield* tags.of(projectId);
    const rows = touched.filter((row) => row.projectId === projectId);
    yield* judgeStealth(
      db,
      table,
      rows.filter((row) => row.stealth),
    );
    const crossings = [
      ...(yield* outgoing(
        db,
        table,
        names,
        projectId,
        rows.filter((row) => !row.stealth),
      )),
      ...(yield* incoming(db, table, names, projectId, movedInto(recorded, rows))),
    ];
    if (crossings.length > 0) return yield* dependency(crossings);
  }
});

const movedInto = (recorded: readonly ActEntry[], rows: readonly Row[]): readonly number[] => {
  const hidden = new Set(rows.filter((row) => row.stealth).map((row) => row.id));
  return recorded.flatMap((entry) => {
    if (entry.op !== 'update' || entry.blockId === null || !hidden.has(entry.blockId)) return [];
    const read = readJournal.update(entry);
    return read._tag === 'Success' && read.success.storage === 'stealth' ? [entry.blockId] : [];
  });
};

const judgeStealth = Effect.fnUntraced(function* (db: StoreDb<'graph'>, table: TagTable, rows: readonly Row[]) {
  if (rows.length === 0) return;
  const module = rows.find((row) => table.supports(row, MODULE));
  if (module !== undefined) {
    return yield* new GateRefusal('stealth-module', `${blockName(module.uuid)} is a module card, and module cards are never stealth`, [
      `set_block_storage ${blockName(module.uuid)} team — the module map judges every clone and CI alike`,
    ]);
  }
  for (const page of pages(rows.map((row) => row.id))) {
    const replaced = yield* db
      .select({ from: block.uuid, to: parent.uuid })
      .from(edge)
      .innerJoin(block, eq(block.id, edge.fromId))
      .innerJoin(parent, eq(parent.id, edge.toId))
      .where(and(inArray(edge.fromId, page), eq(edge.kind, 'supersedes'), eq(parent.stealth, false)))
      .get();
    if (replaced !== undefined) {
      return yield* new GateRefusal(
        'stealth-supersede',
        `stealth block ${blockName(replaced.from)} would replace team block ${blockName(replaced.to)}, and a clone of the repository would still read it current`,
        [
          `set_block_storage ${blockName(replaced.from)} team — a replacement the repository can read`,
          `close or edit ${blockName(replaced.to)} in place instead`,
        ],
      );
    }
  }
});

const outgoing = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  names: BlockNames['Service'],
  projectId: number,
  rows: readonly Row[],
) {
  const crossings: Crossing[] = [];
  if (rows.length === 0) return crossings;
  for (const page of pages(rows.map((row) => row.id))) {
    for (const one of yield* db
      .select({ team: block.uuid, stealth: parent.uuid })
      .from(block)
      .innerJoin(parent, eq(parent.id, block.parentId))
      .where(and(inArray(block.id, page), eq(parent.stealth, true)))) {
      crossings.push({ team: blockName(one.team), stealth: blockName(one.stealth), via: 'parent' });
    }
    for (const one of yield* db
      .select({ team: block.uuid, stealth: parent.uuid, kind: edge.kind })
      .from(edge)
      .innerJoin(block, eq(block.id, edge.fromId))
      .innerJoin(parent, eq(parent.id, edge.toId))
      .where(and(inArray(edge.fromId, page), eq(parent.stealth, true), isNull(parent.deletedAt)))) {
      crossings.push({ team: blockName(one.team), stealth: blockName(one.stealth), via: `edge ${one.kind}` });
    }
    for (const one of yield* db
      .select({ team: block.uuid, stealth: parent.uuid })
      .from(ref)
      .innerJoin(block, eq(block.id, ref.fromId))
      .innerJoin(parent, eq(parent.id, ref.toId))
      .where(and(inArray(ref.fromId, page), eq(parent.stealth, true), isNull(parent.deletedAt)))) {
      crossings.push({ team: blockName(one.team), stealth: blockName(one.stealth), via: 'reference in the body' });
    }
  }
  const declared = new Set(
    (yield* db
      .select({ fields: block.fields })
      .from(block)
      .innerJoin(blockTag, eq(blockTag.blockId, block.id))
      .where(
        and(eq(block.projectId, projectId), eq(blockTag.tag, TAG_DECLARATION.id), eq(block.stealth, true), isNull(block.deletedAt)),
      )).flatMap((row) => (typeof row.fields.id === 'string' ? [row.fields.id] : [])),
  );
  for (const row of rows) {
    for (const tag of table.tagsOf(row)) {
      if (declared.has(tag.id)) crossings.push({ team: blockName(row.uuid), stealth: `#${tag.id}`, via: 'its tag is declared stealth' });
    }
  }
  const named = yield* fieldNames(table, rows);
  if (named.length === 0) return crossings;
  const found = yield* names.idsOfNames(named.map((one) => one.name));
  const hidden = new Map<number, string>();
  for (const page of pages([...new Set(found.values())])) {
    for (const one of yield* db
      .select({ id: block.id, uuid: block.uuid })
      .from(block)
      .where(and(inArray(block.id, page), eq(block.projectId, projectId), eq(block.stealth, true), isNull(block.deletedAt)))) {
      hidden.set(one.id, one.uuid);
    }
  }
  for (const { row, field, name } of named) {
    const id = found.get(name);
    const target = id === undefined ? undefined : hidden.get(id);
    if (target !== undefined) crossings.push({ team: blockName(row.uuid), stealth: blockName(target), via: `field ${field}` });
  }
  return crossings;
});

const incoming = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  names: BlockNames['Service'],
  projectId: number,
  moved: readonly number[],
) {
  const crossings: Crossing[] = [];
  if (moved.length === 0) return crossings;
  const subtree = new Map<number, string>();
  for (const page of pages(moved)) {
    for (const one of yield* db.select({ id: block.id, uuid: block.uuid }).from(block).where(inArray(block.id, page)))
      subtree.set(one.id, one.uuid);
  }
  for (let frontier = [...moved]; frontier.length > 0;) {
    const next: number[] = [];
    for (const page of pages(frontier)) {
      for (const child of yield* db
        .select({ id: block.id, uuid: block.uuid })
        .from(block)
        .where(and(inArray(block.parentId, page), isNull(block.deletedAt)))) {
        if (!subtree.has(child.id)) {
          subtree.set(child.id, child.uuid);
          next.push(child.id);
        }
      }
    }
    frontier = next;
  }
  for (const page of pages([...subtree.keys()])) {
    for (const one of yield* db
      .select({ team: block.uuid, stealth: parent.uuid, kind: edge.kind })
      .from(edge)
      .innerJoin(block, eq(block.id, edge.fromId))
      .innerJoin(parent, eq(parent.id, edge.toId))
      .where(and(inArray(edge.toId, page), eq(block.stealth, false), isNull(block.deletedAt)))) {
      crossings.push({ team: blockName(one.team), stealth: blockName(one.stealth), via: `edge ${one.kind}` });
    }
    for (const one of yield* db
      .select({ team: block.uuid, stealth: parent.uuid })
      .from(ref)
      .innerJoin(block, eq(block.id, ref.fromId))
      .innerJoin(parent, eq(parent.id, ref.toId))
      .where(and(inArray(ref.toId, page), eq(block.stealth, false), isNull(block.deletedAt)))) {
      crossings.push({ team: blockName(one.team), stealth: blockName(one.stealth), via: 'reference in the body' });
    }
  }
  const holders = holderTags(table);
  if (holders.length === 0) return crossings;
  const team = (yield* db
    .selectDistinct({ row: block })
    .from(block)
    .innerJoin(blockTag, eq(blockTag.blockId, block.id))
    .where(
      and(eq(block.projectId, projectId), eq(block.stealth, false), isNull(block.deletedAt), inArray(blockTag.tag, [...holders])),
    )).map((one) => one.row);
  const named = yield* fieldNames(table, team);
  if (named.length === 0) return crossings;
  const found = yield* names.idsOfNames(named.map((one) => one.name));
  for (const { row, field, name } of named) {
    const id = found.get(name);
    const target = id === undefined ? undefined : subtree.get(id);
    if (target !== undefined) crossings.push({ team: blockName(row.uuid), stealth: blockName(target), via: `field ${field}` });
  }
  return crossings;
});
