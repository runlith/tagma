import { getTableName, type Table } from 'drizzle-orm';
import { Context, Data } from 'effect';
import type { DurabilityClass } from './durability.js';

export type WriteSet = {
  readonly operation: string;
  readonly durability: DurabilityClass;
  readonly reach: ReadonlyMap<string, ReadonlySet<string> | 'all'>;
};

const reachOf = (tables: readonly Table[], joined: readonly WriteSet[]): ReadonlyMap<string, ReadonlySet<string> | 'all'> => {
  const reach = new Map<string, Set<string> | 'all'>();
  const widen = (table: string, columns: ReadonlySet<string> | 'all') => {
    const standing = reach.get(table);
    reach.set(table, standing === 'all' || columns === 'all' ? 'all' : new Set([...(standing ?? []), ...columns]));
  };
  for (const set of joined) for (const [table, columns] of set.reach) widen(table, columns);
  for (const table of tables) widen(getTableName(table).toLowerCase(), 'all');
  return reach;
};

export const writes = (operation: string, tables: readonly Table[], ...joined: readonly WriteSet[]): WriteSet => ({
  operation,
  durability: 'durable',
  reach: reachOf(tables, joined),
});

export type WriteSetMode = 'report' | 'refuse';

export const WriteSetMode = Context.Reference<WriteSetMode>('tagma/platform/WriteSetMode', { defaultValue: () => 'report' });

export class UnitWriteRefused extends Data.TaggedError('UnitWriteRefused')<{
  readonly store: string;
  readonly operation: string;
  readonly table: string | null;
  readonly reason: 'outside-write-set' | 'unresolved-target' | 'durable-in-relaxed';
}> {
  override get message(): string {
    const what = this.table === null ? 'a statement whose target could not be read' : `a write to ${this.table}`;
    return `${this.store}: the ${this.operation} unit ran ${what} (${this.reason})`;
  }
}
