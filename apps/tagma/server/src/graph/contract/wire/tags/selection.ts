import type { ContractId } from './behaviour.js';
import type { Tag } from './declaration.js';

export const SELECTION: ContractId = 'core/selection';

export type Selection = { readonly query: string; readonly layout?: string };

export function selectionOf(tag: Tag): Selection | null {
  const slots = tag.contracts?.[SELECTION]?.slots;
  const query = slots?.query;
  if (query === undefined) return null;
  const layout = slots?.layout;
  return layout === undefined ? { query } : { query, layout };
}
