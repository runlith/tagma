import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Effect } from 'effect';
import { SnapshotFailed } from '../contract/service/snapshots.js';

export type SnapshotWitnessTable = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly keys: readonly string[];
};

type KeyPosition = {
  readonly type: string;
  readonly enc: string;
};

const FIELD_OVERHEAD = 64;

const BATCH_BYTES = 4 * 1024 * 1024;

const FIRST_BATCH = 16;

const GROWTH = 8;

const LARGEST_BATCH = 50_000;

export const nextBatch = (asked: number, read: number): number =>
  Math.max(1, Math.min(LARGEST_BATCH, asked * GROWTH, Math.floor((asked * BATCH_BYTES) / Math.max(1, read))));

const integerOf = (enc: string): boolean => /^-?\d+$/.test(enc);

const realOf = (enc: string): boolean => /^[+-]?(\d+\.\d*|\d*\.\d+|\d+)([eE][+-]?\d+)?$/.test(enc);

const hexOf = (enc: string): boolean => enc.length % 2 === 0 && /^[0-9A-Fa-f]*$/.test(enc);

const literalOf = (type: string, enc: string): string | null => {
  if (type === 'integer') return integerOf(enc) ? enc : null;
  if (type === 'real') {
    if (enc === 'Inf') return '9e999';
    if (enc === '-Inf') return '-9e999';
    return realOf(enc) ? enc : null;
  }
  if (type === 'text') return hexOf(enc) ? `CAST(x'${enc}' AS TEXT)` : null;
  if (type === 'blob') return hexOf(enc) ? `x'${enc}'` : null;
  return null;
};

const payloadBytes = (type: string, enc: string | null): number | null => {
  if (enc === null) return type === 'null' ? 0 : null;
  if (type === 'text' || type === 'blob') return hexOf(enc) ? enc.length / 2 : null;
  if (type === 'integer') return integerOf(enc) ? enc.length : null;
  if (type === 'real') return enc === 'Inf' || enc === '-Inf' || realOf(enc) ? enc.length : null;
  return null;
};

const encodedOf = (ident: ReturnType<typeof sql.identifier>) =>
  sql`case when typeof(${ident}) = 'integer' then cast(${ident} as text) when typeof(${ident}) = 'real' then printf('%!.26g', ${ident}) when typeof(${ident}) = 'text' then hex(${ident}) when typeof(${ident}) = 'blob' then hex(${ident}) else null end`;

const readBatch = Effect.fnUntraced(function* (
  db: EffectSQLiteBunDatabase,
  table: SnapshotWitnessTable,
  limit: number,
  last: readonly KeyPosition[] | null,
) {
  const parts = [];
  for (let i = 0; i < table.keys.length; i++) {
    const ident = sql.identifier(table.keys[i]!);
    parts.push(sql`typeof(${ident}) as ${sql.identifier(`k${i}t`)}`);
    parts.push(sql`${encodedOf(ident)} as ${sql.identifier(`k${i}v`)}`);
  }
  for (let j = 0; j < table.columns.length; j++) {
    const ident = sql.identifier(table.columns[j]!);
    parts.push(sql`typeof(${ident}) as ${sql.identifier(`c${j}t`)}`);
    parts.push(sql`${encodedOf(ident)} as ${sql.identifier(`c${j}v`)}`);
  }
  const select = sql.join(parts, sql`, `);
  const from = sql`from main.${sql.identifier(table.name)}`;
  const order = sql`order by ${sql.join(
    table.keys.map((key) => sql.identifier(key)),
    sql`, `,
  )}`;
  const cap = sql`limit ${sql.raw(String(limit))}`;
  if (last === null) {
    return yield* db
      .all<Record<string, string | null>>(sql`select ${select} ${from} ${order} ${cap}`)
      .pipe(Effect.mapError(() => new SnapshotFailed({ path: table.name, reason: 'snapshot witness read failed' })));
  }
  const texts: string[] = [];
  for (const key of last) {
    const text = literalOf(key.type, key.enc);
    if (text === null) return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness key cannot be witnessed' });
    texts.push(text);
  }
  const literals = texts.map((text) => sql.raw(text));
  const ordered = table.keys.map((key) => sql.identifier(key));
  const where =
    ordered.length === 1
      ? sql`where ${ordered[0]!} > ${literals[0]!}`
      : sql`where (${sql.join(ordered, sql`, `)}) > (${sql.join(literals, sql`, `)})`;
  return yield* db
    .all<Record<string, string | null>>(sql`select ${select} ${from} ${where} ${order} ${cap}`)
    .pipe(Effect.mapError(() => new SnapshotFailed({ path: table.name, reason: 'snapshot witness read failed' })));
});

export const snapshotWitness = Effect.fn('Store.snapshotWitness')(function* (
  db: EffectSQLiteBunDatabase,
  tables: readonly SnapshotWitnessTable[],
): Effect.fn.Return<
  { readonly hash: string; readonly rows: Readonly<Record<string, number>>; readonly bytes: Readonly<Record<string, number>> },
  SnapshotFailed
> {
  const hash = createHash('sha256');
  const feed = (value: string): void => {
    hash.update(`${value.length}:`);
    hash.update(value, 'utf8');
    hash.update(';');
  };
  feed('tables');
  feed(String(tables.length));
  const rows: Record<string, number> = {};
  const bytes: Record<string, number> = {};
  for (const table of tables) {
    if (table.name.length === 0 || table.keys.length === 0) {
      return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness needs a named table with keys' });
    }
    for (const key of table.keys) {
      if (key.length === 0) return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness needs named keys' });
    }
    for (const column of table.columns) {
      if (column.length === 0) return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness needs named columns' });
    }
    feed('table');
    feed(table.name);
    feed('keys');
    feed(String(table.keys.length));
    for (const key of table.keys) feed(key);
    feed('columns');
    feed(String(table.columns.length));
    for (const column of table.columns) feed(column);
    let limit = FIRST_BATCH;
    let count = 0;
    let payload = 0;
    let last: readonly KeyPosition[] | null = null;
    for (;;) {
      const page = yield* readBatch(db, table, limit, last);
      if (page.length === 0) break;
      let read = 0;
      for (const row of page) {
        const keys: KeyPosition[] = [];
        for (let i = 0; i < table.keys.length; i++) {
          const type = row[`k${i}t`];
          const enc = row[`k${i}v`];
          if (typeof type !== 'string' || typeof enc !== 'string') {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness key cannot be witnessed' });
          }
          if (type !== 'integer' && type !== 'real' && type !== 'text' && type !== 'blob') {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness key cannot be witnessed' });
          }
          if (literalOf(type, enc) === null) {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness key cannot be witnessed' });
          }
          feed(type);
          feed(enc);
          read += enc.length + FIELD_OVERHEAD;
          keys.push({ type, enc });
        }
        for (let j = 0; j < table.columns.length; j++) {
          const type = row[`c${j}t`];
          const enc = row[`c${j}v`];
          if (typeof type !== 'string' || (typeof enc !== 'string' && enc !== null)) {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness value cannot be witnessed' });
          }
          if (type !== 'integer' && type !== 'real' && type !== 'text' && type !== 'blob' && type !== 'null') {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness value cannot be witnessed' });
          }
          const size = payloadBytes(type, enc);
          if (size === null) {
            return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot witness value cannot be witnessed' });
          }
          feed(type);
          feed(enc === null ? 'null' : enc);
          payload += size;
          read += (enc === null ? 0 : enc.length) + FIELD_OVERHEAD;
        }
        last = keys;
      }
      count += page.length;
      if (page.length < limit) break;
      limit = nextBatch(limit, read);
    }
    feed('rows');
    feed(String(count));
    rows[table.name] = (rows[table.name] ?? 0) + count;
    bytes[table.name] = (bytes[table.name] ?? 0) + payload;
  }
  return { hash: hash.digest('hex'), rows, bytes };
});
