import { type Context, Effect } from 'effect';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { ActState } from '../contract/service/transaction.js';

export function unitState(): Context.Service.Shape<typeof ActState> {
  return {
    vocabulary: new Set<number>(),
    tables: new Map<number, TagTable>(),
    recorded: [],
    unit: null,
  };
}

export function withUnit(held: Context.Service.Shape<typeof ActState>, unit: WriteUnit<'graph'>): Context.Service.Shape<typeof ActState> {
  held.unit = unit;
  return held;
}

export const transactionUnit: Effect.Effect<WriteUnit<'graph'>, never, ActState> = Effect.flatMap(ActState, (held) =>
  held.unit === null ? Effect.die('a graph transaction was opened without its store unit') : Effect.succeed(held.unit),
);
