import { Effect } from 'effect';
import { eq, inArray } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { session } from '../../platform/store/writers.js';
import { pagesOf } from '../../platform/store/binds.js';
import { parseSessionToken, sessionToken } from '../../platform/contract/wire/session.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { transactionUnit } from '../acts/state.js';
import type { Tagged } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';

export type SessionSpelling = { readonly blockId: number; readonly field: string; readonly spelling: string | number | null };

export const ELSEWHERE = 'elsewhere';

export const elsewhere = Effect.fnUntraced(function* (unit: WriteUnit<'graph'>, number: number) {
  return (yield* (yield* WriterRegister).resolve(unit, { harness: ELSEWHERE, key: String(number) })).id;
});

export const sessionFields = (table: TagTable): ((node: { readonly tags: readonly string[] }) => readonly string[]) => {
  const declared = new Map<string, readonly string[]>();
  const ofTag = (id: string): readonly string[] => {
    let names = declared.get(id);
    if (names === undefined) {
      const fields = table.tagById(id)?.fields ?? {};
      names = Object.keys(fields).filter((name) => fields[name] === 'session');
      declared.set(id, names);
    }
    return names;
  };
  return (node) => (node.tags.length === 1 ? ofTag(node.tags[0]!) : [...new Set(node.tags.flatMap(ofTag))]);
};

export const spelledSessions = Effect.fnUntraced(function* (
  table: TagTable,
  rows: readonly (Tagged & { readonly id: number })[],
): Effect.fn.Return<readonly SessionSpelling[], StoreFailure, GraphStore> {
  if (!table.tags.some((tag) => Object.values(tag.fields).includes('session'))) return [];
  const declared = sessionFields(table);
  const local: { readonly blockId: number; readonly field: string; readonly id: number }[] = [];
  for (const row of rows) {
    for (const field of declared(row)) {
      const value = row.fields[field];
      if (typeof value === 'number') local.push({ blockId: row.id, field, id: value });
    }
  }
  if (local.length === 0) return [];
  const { db } = yield* GraphStore;
  const spellings = new Map<number, string | number>();
  for (const page of pagesOf([...new Set(local.map((entry) => entry.id))], 1)) {
    const named = yield* db
      .select({ id: session.id, harness: session.harness, key: session.key })
      .from(session)
      .where(inArray(session.id, page));
    for (const row of named) spellings.set(row.id, row.harness === ELSEWHERE ? Number(row.key) : sessionToken(row));
  }
  return local.map((entry) => ({ blockId: entry.blockId, field: entry.field, spelling: spellings.get(entry.id) ?? null }));
});

const spelledHere = Effect.fnUntraced(function* (kept: unknown, value: number) {
  if (kept !== value) return false;
  const { db } = yield* GraphStore;
  const named = yield* (yield* transactionUnit).run(
    db.select({ harness: session.harness }).from(session).where(eq(session.id, value)).get(),
  );
  return named?.harness !== ELSEWHERE;
});

export const readSessions = Effect.fnUntraced(function* (
  table: TagTable,
  node: Tagged,
  own: Readonly<Record<string, unknown>> | undefined,
) {
  const fields: Record<string, unknown> = { ...node.fields };
  for (const field of sessionFields(table)(node)) {
    const value = fields[field];
    const ref = typeof value === 'string' ? parseSessionToken(value) : null;
    if (ref !== null) fields[field] = (yield* (yield* WriterRegister).resolve(yield* transactionUnit, ref)).id;
    else if (typeof value === 'number') {
      fields[field] = (yield* spelledHere(own?.[field], value)) ? value : yield* elsewhere(yield* transactionUnit, value);
    }
  }
  return fields;
});
