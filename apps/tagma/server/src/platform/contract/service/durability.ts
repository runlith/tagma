import { type Column, getColumnTable, getTableName } from 'drizzle-orm';
import { Data } from 'effect';
import type { WriteSet } from './writes.js';

export type DurabilityClass = 'durable' | 'relaxed';

const transientColumns = new WeakSet<Column>();

export class RelaxedWriteInvalid extends Data.TaggedError('RelaxedWriteInvalid')<{ readonly operation: string; readonly column: string }> {
  override get message(): string {
    return `${this.operation} declares ${this.column} relaxed, but its table does not declare that column derived or transient`;
  }
}

export const transient = (...columns: readonly Column[]): void => {
  for (const column of columns) transientColumns.add(column);
};

export const relaxedWrites = (operation: string, columns: readonly Column[]): WriteSet => {
  const reach = new Map<string, Set<string>>();
  for (const column of columns) {
    const table = getTableName(getColumnTable(column)).toLowerCase();
    if (!transientColumns.has(column)) throw new RelaxedWriteInvalid({ operation, column: `${table}.${column.name}` });
    reach.set(table, (reach.get(table) ?? new Set()).add(column.name.toLowerCase()));
  }
  return { operation, durability: 'relaxed', reach };
};
