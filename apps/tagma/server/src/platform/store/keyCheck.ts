import { Clock, Effect } from 'effect';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import type { SqlError } from 'effect/sql/SqlError';
import { sql } from 'drizzle-orm';
import type { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { type ForeignKey, type KeyChange, type KeyReach, keyPlan, keySetName } from './keyPlan.js';
import { columnShape } from './columnShape.js';

type Failure = SqlError | EffectDrizzleQueryError;

export type KeyCapture = { readonly parent: string; readonly to: readonly string[]; readonly table: string };

export type KeyScan = { readonly table: string; readonly ms: number };

export type KeysChecked = { readonly dangling: readonly unknown[]; readonly scans: readonly KeyScan[] };

type Column = { readonly name: string; readonly type: string; readonly pk: number };

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const columnsOf = (db: EffectSQLiteBunDatabase, table: string): Effect.Effect<ReadonlyArray<Column>, Failure> =>
  db.all<Column>(sql`select name, type, pk from pragma_table_xinfo(${table})`);

const affinity = (type: string): string => {
  const declared = type.toUpperCase();
  if (declared.includes('INT')) return 'integer';
  if (/CHAR|CLOB|TEXT/.test(declared)) return 'text';
  if (declared === '' || declared.includes('BLOB')) return 'blob';
  if (/REAL|FLOA|DOUB/.test(declared)) return 'real';
  return 'numeric';
};

export const foreignKeys = Effect.fn('Store.foreignKeys')(function* (
  db: EffectSQLiteBunDatabase,
): Effect.fn.Return<ReadonlyArray<ForeignKey>, Failure> {
  const rows = yield* db.all<{ child: string; parent: string; id: number; from: string; to: string | null }>(
    sql`select m.name as child, p."table" as parent, p.id as id, p."from" as "from", p."to" as "to" from sqlite_master m join pragma_foreign_key_list(m.name) p where m.type = 'table' order by m.name, p.id, p.seq`,
  );
  const grouped = new Map<string, { child: string; parent: string; id: number; from: string[]; to: (string | null)[] }>();
  for (const row of rows) {
    const key = `${row.child}\u0000${row.id}`;
    const group = grouped.get(key) ?? { child: row.child, parent: row.parent, id: row.id, from: [], to: [] };
    group.from.push(row.from);
    group.to.push(row.to);
    grouped.set(key, group);
  }
  const primaryKeys = new Map<string, readonly string[]>();
  const keys: ForeignKey[] = [];
  for (const group of grouped.values()) {
    let to = group.to as readonly (string | null)[];
    if (to.some((column) => column === null)) {
      const parent = group.parent.toLowerCase();
      if (!primaryKeys.has(parent)) {
        const columns = yield* columnsOf(db, group.parent);
        primaryKeys.set(
          parent,
          columns
            .filter((column) => column.pk > 0)
            .toSorted((a, b) => a.pk - b.pk)
            .map((column) => column.name),
        );
      }
      to = primaryKeys.get(parent)!;
    }
    keys.push({ child: group.child, parent: group.parent, id: group.id, from: group.from, to: to as readonly string[] });
  }
  return keys;
});

const indexedOn = Effect.fn('Store.indexedOn')(function* (
  db: EffectSQLiteBunDatabase,
  key: ForeignKey,
): Effect.fn.Return<boolean, Failure> {
  const rows = yield* db.all<{ index: string; column: string | null }>(
    sql`select l.name as "index", i.name as "column" from pragma_index_list(${key.child}) l join pragma_index_info(l.name) i where l.partial = 0 order by l.name, i.seqno`,
  );
  const wanted = new Set(key.from.map((column) => column.toLowerCase()));
  const leading = new Map<string, (string | null)[]>();
  for (const row of rows) {
    const columns = leading.get(row.index) ?? [];
    columns.push(row.column === null ? null : row.column.toLowerCase());
    leading.set(row.index, columns);
  }
  return [...leading.values()].some(
    (columns) => columns.length >= wanted.size && columns.slice(0, wanted.size).every((column) => column !== null && wanted.has(column)),
  );
});

const comparable = Effect.fn('Store.keysComparable')(function* (
  db: EffectSQLiteBunDatabase,
  key: ForeignKey,
): Effect.fn.Return<boolean, Failure> {
  const parent = new Map((yield* columnsOf(db, key.parent)).map((column) => [column.name.toLowerCase(), column] as const));
  const child = new Map((yield* columnsOf(db, key.child)).map((column) => [column.name.toLowerCase(), column] as const));
  for (const [index, to] of key.to.entries()) {
    const target = parent.get(to.toLowerCase());
    const source = child.get(key.from[index]!.toLowerCase());
    if (target === undefined || source === undefined || affinity(target.type) !== affinity(source.type)) return false;
  }
  const ddl = yield* db.all<{ sql: string | null }>(
    sql`select sql from sqlite_master where type = 'table' and name in (${key.parent}, ${key.child})`,
  );
  return ddl.length > 0 && ddl.every((table) => table.sql !== null && !/\bcollate\b/i.test(table.sql));
});

export const captureKeys = Effect.fn('Store.captureKeys')(function* (
  db: EffectSQLiteBunDatabase,
  keys: readonly ForeignKey[],
  held: readonly KeyCapture[] = [],
): Effect.fn.Return<ReadonlyArray<KeyCapture>, Failure> {
  if (keys.length === 0) return held;
  const captures = new Map(held.map((capture) => [keySetName(capture.parent, capture.to), capture]));
  for (const key of keys) {
    const name = keySetName(key.parent, key.to);
    if (key.to.length === 0 || captures.has(name)) continue;
    const table = `tagma_keys_${captures.size}`;
    yield* db.run(
      sql.raw(`create temp table ${quoted(table)} as select distinct ${key.to.map(quoted).join(', ')} from main.${quoted(key.parent)}`),
    );
    captures.set(name, { parent: key.parent, to: key.to, table });
  }
  return [...captures.values()];
});

const removedKeys = Effect.fn('Store.removedKeys')(function* (
  db: EffectSQLiteBunDatabase,
  capture: KeyCapture,
): Effect.fn.Return<KeyChange, Failure> {
  const columns = new Set((yield* columnsOf(db, capture.parent)).map((column) => column.name.toLowerCase()));
  if (!capture.to.every((column) => columns.has(column.toLowerCase())))
    return { parent: capture.parent, to: capture.to, removed: 'unread' };
  const gone = `${capture.table}_gone`;
  yield* db.run(
    sql.raw(
      `create temp table ${quoted(gone)} as select * from temp.${quoted(capture.table)} except select ${capture.to.map(quoted).join(', ')} from main.${quoted(capture.parent)}`,
    ),
  );
  const [counted] = yield* db.all<{ n: number }>(sql.raw(`select count(*) as n from temp.${quoted(gone)}`));
  return { parent: capture.parent, to: capture.to, removed: counted?.n ?? 0 };
});

const parentKey = Effect.fn('Store.parentKey')(function* (
  db: EffectSQLiteBunDatabase,
  key: ForeignKey,
): Effect.fn.Return<boolean, Failure> {
  const [table] = yield* db.all<{ sql: string | null; wr: number }>(sql`
    select m.sql, t.wr from sqlite_master m join pragma_table_list t on t.schema = 'main' and t.name = m.name
    where m.type = 'table' and lower(m.name) = ${key.parent.toLowerCase()}`);
  if (table === undefined) return true;
  if (table.sql === null || key.to.length === 0 || key.to.length !== key.from.length) return false;
  const columns = yield* columnsOf(db, key.parent);
  const primary = columns.filter((column) => column.pk > 0);
  const rows = yield* db.all<{ index: string; origin: string; column: string | null; collation: string }>(sql`
    select l.name as "index", l.origin, i.name as "column", i.coll as collation from pragma_index_list(${key.parent}) l
    join pragma_index_xinfo(l.name) i where l."unique" = 1 and l.partial = 0 and i."key" = 1 order by l.name, i.seqno`);
  if (
    table.wr === 0 &&
    primary.length === 1 &&
    primary[0]!.type.toUpperCase() === 'INTEGER' &&
    key.to.length === 1 &&
    primary[0]!.name.toLowerCase() === key.to[0]!.toLowerCase() &&
    !rows.some((row) => row.origin === 'pk')
  )
    return true;
  const collations = columnShape(table.sql).collations;
  const wanted = new Set(key.to.map((column) => column.toLowerCase()));
  const indexes = new Map<string, { column: string | null; collation: string }[]>();
  for (const row of rows) {
    const entries = indexes.get(row.index) ?? [];
    entries.push({ column: row.column?.toLowerCase() ?? null, collation: row.collation.toLowerCase() });
    indexes.set(row.index, entries);
  }
  return [...indexes.values()].some(
    (entries) =>
      entries.length === wanted.size &&
      entries.every(
        (entry) => entry.column !== null && wanted.has(entry.column) && entry.collation === (collations.get(entry.column) ?? 'binary'),
      ),
  );
});

export const checkKeys = Effect.fn('Store.checkKeys')(function* (
  db: EffectSQLiteBunDatabase,
  captures: ReadonlyArray<KeyCapture>,
  reach: KeyReach,
): Effect.fn.Return<KeysChecked, Failure> {
  const scans: KeyScan[] = [];
  const dangling: unknown[] = [];
  const changes = yield* Effect.forEach(captures, (capture) => removedKeys(db, capture));
  const plan = keyPlan({ ...reach, changes });
  const validity = new Map<string, boolean>();
  const touched = new Set([...reach.touched].map((table) => table.toLowerCase()));
  for (const key of [
    ...plan.checks,
    ...plan.defaults,
    ...plan.probes,
    ...reach.keys.filter((key) => touched.has(key.parent.toLowerCase())),
  ]) {
    const name = keySetName(key.parent, key.to);
    if (!validity.has(name)) validity.set(name, yield* parentKey(db, key));
    if (validity.get(name) === false) dangling.push({ table: key.child, parent: key.parent, reason: 'foreign-key-mismatch' });
  }
  if (
    dangling.length > 0 ||
    (plan.full.length === 0 && plan.checks.length === 0 && plan.defaults.length === 0 && plan.probes.length === 0)
  ) {
    yield* releaseKeys(db, captures);
    return { dangling, scans };
  }
  const full = new Set(plan.full);
  const checks = [...plan.checks];
  const gone = new Map(captures.map((capture) => [keySetName(capture.parent, capture.to), `${capture.table}_gone`] as const));
  const probes: ForeignKey[] = [];
  for (const key of plan.probes) {
    if (gone.has(keySetName(key.parent, key.to)) && (yield* comparable(db, key))) probes.push(key);
    else if (reach.restored.size > 0) full.add(key.child.toLowerCase());
    else checks.push(key);
  }
  const standing = new Map(
    (yield* db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)).map(
      (row) => [row.name.toLowerCase(), row.name] as const,
    ),
  );
  for (const key of plan.defaults) {
    const [column] = yield* db.all<{ hidden: number; value: string | null }>(sql`
      select hidden, dflt_value as value from pragma_table_xinfo(${key.child}) where lower(name) = ${key.from[0]!.toLowerCase()}`);
    if (column === undefined || column.hidden !== 0) {
      checks.push(key);
      continue;
    }
    if (column.value === null || column.value.trim().toLowerCase() === 'null') continue;
    const [row] = yield* db.all<{ value: unknown }>(
      sql`select ${sql.identifier(key.from[0]!)} as value from main.${sql.identifier(key.child)} limit 1`,
    );
    if (row === undefined || row.value === null) continue;
    const found = standing.has(key.parent.toLowerCase())
      ? yield* db.all(sql`select 1 from main.${sql.identifier(key.parent)} where ${sql.identifier(key.to[0]!)} = ${row.value} limit 1`)
      : [];
    if (found.length === 0) dangling.push({ table: key.child, parent: key.parent, column: key.from[0], value: row.value });
  }
  for (const table of [...full].flatMap((name) => standing.get(name) ?? [])) {
    dangling.push(...(yield* db.all(sql`PRAGMA foreign_key_check(${sql.identifier(table)})`)));
  }
  for (const key of checks) {
    if (full.has(key.child.toLowerCase()) || !standing.has(key.child.toLowerCase())) continue;
    if (key.to.length === 0 || key.to.length !== key.from.length) {
      dangling.push(...(yield* db.all(sql`PRAGMA foreign_key_check(${sql.identifier(key.child)})`)));
      continue;
    }
    const fields = key.from.map((column) => `child.${quoted(column)}`);
    const nonnull = fields.map((field) => `${field} is not null`).join(' and ');
    const matches = key.to.map((column, index) => `parent.${quoted(column)} = +${fields[index]}`).join(' and ');
    const parent = standing.has(key.parent.toLowerCase())
      ? `not exists (select 1 from main.${quoted(key.parent)} parent where ${matches})`
      : '1';
    const found = yield* db.all(
      sql.raw(`select ${fields.join(', ')} from main.${quoted(key.child)} child where ${nonnull} and ${parent} limit 5`),
    );
    dangling.push(...found.map((row) => ({ table: key.child, parent: key.parent, row })));
  }
  for (const key of probes) {
    if (full.has(key.child.toLowerCase())) continue;
    const removed = gone.get(keySetName(key.parent, key.to))!;
    const indexed = yield* indexedOn(db, key);
    const startedAt = yield* Clock.currentTimeMillis;
    const from = key.from.length === 1 ? quoted(key.from[0]!) : `(${key.from.map(quoted).join(', ')})`;
    const found = yield* db.all(
      sql.raw(
        `select ${key.from.map(quoted).join(', ')} from main.${quoted(key.child)} where ${from} in (select * from temp.${quoted(removed)}) limit 5`,
      ),
    );
    dangling.push(...found.map((row) => ({ table: key.child, parent: key.parent, row })));
    if (!indexed) scans.push({ table: key.child, ms: (yield* Clock.currentTimeMillis) - startedAt });
  }
  yield* releaseKeys(db, captures);
  return { dangling, scans };
});

export const releaseKeys = (db: EffectSQLiteBunDatabase, captures: ReadonlyArray<KeyCapture>): Effect.Effect<void, Failure> =>
  Effect.forEach(
    captures,
    (capture) =>
      Effect.andThen(
        db.run(sql.raw(`drop table if exists temp.${quoted(`${capture.table}_gone`)}`)),
        db.run(sql.raw(`drop table if exists temp.${quoted(capture.table)}`)),
      ),
    { discard: true },
  );
