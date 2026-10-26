import { Result, Schema } from 'effect';
import { contractIdSchema } from './behaviour.js';
import type { TagTable } from './table.js';

export const typeSelectorSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(['exact', 'descendants']),
    types: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({ kind: Schema.Literal('supports'), contract: contractIdSchema }),
]);
export type TypeSelector = typeof typeSelectorSchema.Type;

export type SelectorIssue = { readonly kind: 'unknown-type' | 'unknown-contract'; readonly ref: string };

function expand(table: TagTable, selector: TypeSelector, keys: ReadonlySet<string>): readonly string[] {
  const roots = [...keys];
  return selector.kind === 'descendants' ? [...roots, ...table.descendantsOf(roots)] : roots;
}

export function resolveSelector(
  table: TagTable,
  selector: TypeSelector,
  naming: 'stored' | 'named' = 'stored',
): Result.Result<readonly string[], SelectorIssue> {
  if (selector.kind === 'supports') {
    return table.contracts.includes(selector.contract)
      ? Result.succeed(table.typesSupporting(selector.contract))
      : Result.fail({ kind: 'unknown-contract', ref: selector.contract });
  }
  const keys = new Set<string>();
  for (const ref of selector.types) {
    const key = naming === 'named' ? table.identities.keyOf(ref) : table.identities.resolveStoredType(ref);
    if (key === null) return Result.fail({ kind: 'unknown-type', ref });
    keys.add(key);
  }
  return Result.succeed(expand(table, selector, keys));
}

export function resolveAcross(
  tables: ReadonlyMap<number, TagTable>,
  selector: TypeSelector,
  naming: 'stored' | 'named' = 'stored',
): Result.Result<ReadonlyMap<number, readonly string[]>, SelectorIssue> {
  const unresolved = new Set(selector.kind === 'supports' ? [] : selector.types);
  const selections = selector.kind === 'supports' ? [selector] : selector.types.map((ref) => ({ kind: 'exact' as const, types: [ref] }));
  const projects = new Map<number, readonly string[]>();
  for (const [id, table] of tables) {
    const keys = new Set<string>();
    for (const one of selections) {
      const selected = resolveSelector(table, one, naming);
      if (selected._tag === 'Failure') {
        if (one.kind === 'supports') return Result.fail(selected.failure);
        continue;
      }
      for (const key of selected.success) keys.add(key);
      if (one.kind !== 'supports') for (const ref of one.types) unresolved.delete(ref);
    }
    projects.set(id, expand(table, selector, keys));
  }
  const missing = unresolved.values().next();
  return missing.done ? Result.succeed(projects) : Result.fail({ kind: 'unknown-type', ref: missing.value });
}
