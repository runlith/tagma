import { Effect } from 'effect';
import type { BlockRow } from '../../graph/contract/service/acts.js';
import { Supersession } from '../../graph/contract/service/work.js';
import { isEnabled } from '../../graph/contract/wire/tags/law.js';
import { SPEC } from '../../graph/contract/wire/tags/spec.js';
import type { Tagged } from '../../graph/contract/wire/tags/roles.js';
import { WORK } from '../../graph/contract/wire/tags/work.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';

export type OwnerStanding = 'open' | 'not-owner' | 'ended' | 'replaced';

export const isRule = (table: TagTable, row: Tagged): boolean => table.lawProjection(row) !== null;

export const isSwitchedOn = (table: TagTable, row: Tagged): boolean => isEnabled(table.lawProjection(row), row);

export const enforcementField = (table: TagTable, row: Tagged): string | null => table.lawProjection(row)?.enforcement?.field ?? null;

export const ownerStanding = Effect.fn('enforcement.ownerStanding')(function* (table: TagTable, row: BlockRow) {
  if (!table.supports(row, WORK) && !table.supports(row, SPEC)) return 'not-owner' as const;
  if (table.isTerminal(row)) return 'ended' as const;
  if (yield* (yield* Supersession).isSuperseded(row.id)) return 'replaced' as const;
  return 'open' as const;
});

export const isOpenOwner = Effect.fn('enforcement.isOpenOwner')(function* (table: TagTable, row: BlockRow) {
  return (yield* ownerStanding(table, row)) === 'open';
});
