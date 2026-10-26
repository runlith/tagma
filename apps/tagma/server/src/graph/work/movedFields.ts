import type { TagTable } from '../contract/wire/tags/table.js';
import type { BlockRow } from '../contract/service/acts.js';
import { lifecycleOf, LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';

export function movedFields(table: TagTable, row: BlockRow, status: string, holder?: number | null): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...row.fields };
  const lifecycle = table.bindingTag(row, LIFECYCLE);
  const statusField = lifecycle === null ? undefined : lifecycleOf(lifecycle)?.field;
  if (statusField !== undefined) fields[statusField] = status;
  if (holder === undefined) return fields;
  const holderField = table.bindingTag(row, HOLDER)?.contracts?.[HOLDER]?.slots[HOLDER_SLOT];
  if (holderField === undefined) return fields;
  if (holder === null) delete fields[holderField];
  else fields[holderField] = holder;
  return fields;
}
