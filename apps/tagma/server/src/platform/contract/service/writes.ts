import { getTableName, type Table } from 'drizzle-orm';
import { Context, Data } from 'effect';
import type { DurabilityClass } from './durability.js';
import type { RowProjection } from './projections.js';

export type WriteSet = {
  readonly operation: string;
  readonly durability: DurabilityClass;
  readonly reach: ReadonlyMap<string, ReadonlySet<string> | 'all'>;
  readonly projections?: ReadonlySet<string> | 'effects';
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

export const writes = (operation: string, targets: readonly (Table | RowProjection)[], ...joined: readonly WriteSet[]): WriteSet => {
  const projections = targets.filter((target): target is RowProjection => 'raw' in target);
  return {
    operation,
    durability: 'durable',
    reach: reachOf(
      targets.map((target) => ('raw' in target ? target.table : target)),
      joined,
    ),
    projections: joined.some((set) => set.projections === 'effects')
      ? 'effects'
      : new Set([
          ...joined.flatMap((set) => (set.projections === 'effects' ? [] : [...(set.projections ?? [])])),
          ...projections.map((projection) => projection.raw.id),
        ]),
  };
};

export const projectedEffects = (set: WriteSet): WriteSet => ({ ...set, projections: 'effects' });

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
