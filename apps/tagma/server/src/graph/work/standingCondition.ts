import { type SQL, sql } from 'drizzle-orm';
import { block } from '../store/tables.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { contractNotAt } from '../vocabulary/projection.js';
import { measuredCondition } from '../acts/measurement.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';

export function standingCondition(table: TagTable): SQL {
  const measured = measuredCondition(table);
  return sql`(${contractNotAt(table, LIFECYCLE, 'terminal', block.id)}) and not ((${measured.answered}) or (${measured.superseded}))`;
}
