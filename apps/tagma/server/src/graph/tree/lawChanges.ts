import { Effect, Option, Schema } from 'effect';
import { Act } from '../contract/service/acts.js';
import { lawEnforcementSchema } from '../contract/wire/enforcement.js';
import type { Tagged } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';

const decode = Schema.decodeUnknownOption(lawEnforcementSchema);

const documentOf = (table: TagTable, row: Tagged | undefined) => {
  if (row === undefined) return undefined;
  const field = table.lawProjection(row)?.enforcement;
  if (field?.schema !== 'lawEnforcement') return undefined;
  return row.fields[field.field];
};

export const importedEnforcement = Effect.fnUntraced(function* (
  table: TagTable,
  id: number,
  before: Tagged | undefined,
  after: Tagged,
  at: Date,
) {
  const was = documentOf(table, before);
  const now = documentOf(table, after);
  const prior = was === undefined ? undefined : Option.getOrUndefined(decode(was));
  const next = now === undefined ? undefined : Option.getOrUndefined(decode(now));
  if ((was !== undefined && prior === undefined) || (now !== undefined && next === undefined)) return;
  if ((prior?.debt.length ?? 0) === (next?.debt.length ?? 0)) return;
  yield* (yield* Act).record(
    'enforce',
    id,
    {
      imported: true,
      strictness: next?.strictness ?? 'off',
      debtBefore: prior?.debt ?? [],
      debtAfter: next?.debt ?? [],
      was: prior ?? null,
    },
    at,
  );
});
