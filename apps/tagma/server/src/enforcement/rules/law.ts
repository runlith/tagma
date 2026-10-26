import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Tagged } from '../../graph/contract/wire/tags/roles.js';
import type { LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import { enforcementField } from './predicate.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import { readFieldOption } from '../../graph/vocabulary/declarationRules.js';

type Rule = Tagged & { readonly uuid: string };

export const enforcementOf = Effect.fn('enforcement.enforcementOf')(function* (
  table: TagTable,
  rule: Rule,
): Effect.fn.Return<LawEnforcement | undefined, GateRefusal<'field-invalid'>> {
  const name = enforcementField(table, rule);
  if (name === null) return undefined;
  return yield* readFieldOption(rule, name, 'lawEnforcement');
});
