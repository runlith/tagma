import { type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { blockField, blockTag } from '../store/tables.js';
import type { ContractId } from '../contract/wire/tags/behaviour.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import type { StatusPhase, TagWords } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';

function textOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return (value as readonly unknown[]).flatMap(textOf);
  return [];
}

function isValueField(tag: Tag, name: string): boolean {
  const declared = tag.fields[name];
  return declared !== undefined && !(typeof declared === 'object' && declared.type === 'schema');
}

export type FieldRow = { readonly tag: string; readonly name: string; readonly value: string };

export function projectedTags(node: { readonly tags: readonly string[] }): readonly string[] {
  return [...new Set(node.tags)];
}

export function storedTypeId(table: TagTable, word: string): string | null {
  const key = table.identities.resolveStoredType(word);
  return key === null ? null : (table.identities.typeOf(key)?.id ?? null);
}

export function projectedFields(
  table: TagTable,
  node: { readonly tags: readonly string[]; readonly fields: Readonly<Record<string, unknown>> },
): FieldRow[] {
  return table
    .tagsOf(node)
    .flatMap((tag) =>
      Object.entries(node.fields).flatMap(([name, value]) =>
        isValueField(tag, name) ? textOf(value).map((text) => ({ tag: tag.id, name, value: text })) : [],
      ),
    );
}

export type NodeId = SQL | SQLiteColumn;

function fieldExists(pairs: readonly { tag: string; name: string }[], blockId: NodeId, values: SQL): SQL {
  if (pairs.length === 0) return sql`0`;
  return sql`(${sql.join(
    pairs.map(
      (pair) =>
        sql`exists (select 1 from ${blockField} f where f.block_id = ${blockId} and f.tag = ${pair.tag} and f.name = ${pair.name} and f.value ${values})`,
    ),
    sql` or `,
  )})`;
}

function inList(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`in (null)`
    : sql`in (${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )})`;
}

export function carriesContract(table: TagTable, contract: ContractId, blockId: NodeId): SQL {
  return carriesTag(table.typesSupporting(contract), blockId);
}

export function carriesTag(tags: readonly string[], blockId: NodeId): SQL {
  if (tags.length === 0) return sql`0`;
  return sql`exists (select 1 from ${blockTag} t where t.block_id = ${blockId} and t.tag ${inList(tags)})`;
}

export function slotIn(table: TagTable, contract: ContractId, slot: string, values: readonly string[], blockId: NodeId): SQL {
  return fieldExists(table.slotFields(contract, slot), blockId, inList(values));
}

export function wordsIn(sets: readonly TagWords[], blockId: NodeId): SQL {
  const carried = sets.filter((set) => set.words.length > 0);
  if (carried.length === 0) return sql`0`;
  return sql`(${sql.join(
    carried.map(
      (set) =>
        sql`exists (select 1 from ${blockField} f where f.block_id = ${blockId} and f.tag = ${set.tag} and f.name = ${set.name} and f.value ${inList(set.words)})`,
    ),
    sql` or `,
  )})`;
}

export function contractAt(table: TagTable, contract: ContractId, phase: StatusPhase, blockId: NodeId): SQL {
  return wordsIn(table.wordsAt(contract, phase), blockId);
}

export function contractNotAt(table: TagTable, contract: ContractId, phase: StatusPhase, blockId: NodeId): SQL {
  return sql`not ${contractAt(table, contract, phase, blockId)}`;
}

export function slotValue(table: TagTable, contract: ContractId, slot: string, blockId: NodeId): SQL {
  const pairs = table.slotFields(contract, slot);
  if (pairs.length === 0) return sql`null`;
  const named = sql.join(
    pairs.map((pair) => sql`(f.tag = ${pair.tag} and f.name = ${pair.name})`),
    sql` or `,
  );
  return sql`(select f.value from ${blockField} f where f.block_id = ${blockId} and (${named}) limit 1)`;
}

export function fieldIn(name: string, values: readonly string[], blockId: NodeId): SQL {
  return sql`exists (select 1 from ${blockField} f where f.block_id = ${blockId} and f.name = ${name} and f.value ${inList(values)})`;
}
