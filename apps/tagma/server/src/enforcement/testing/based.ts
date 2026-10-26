import { Effect } from 'effect';
import type { InputOf } from '../../platform/contract/service/body.js';
import { scoped } from '../../graph/operations/crossing.js';
import { currentEnforcementRevision } from '../rules/revision.js';
import type { ENFORCEMENT_OPERATIONS } from '../contract/wire/operationCatalog.js';

export type Unbased = Omit<InputOf<typeof ENFORCEMENT_OPERATIONS.enforce_rule>, 'base'>;

export const based = (input: Unbased) =>
  Effect.map(
    Effect.flatMap(scoped(input.blockId), currentEnforcementRevision),
    (base): InputOf<typeof ENFORCEMENT_OPERATIONS.enforce_rule> => ({ ...input, base }),
  );
