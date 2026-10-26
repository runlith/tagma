import type { ContractId } from './behaviour.js';
import type { Tag } from './declaration.js';

export const AMENDMENT: ContractId = 'core/amendment';

export type Amendment = { readonly ops: string; readonly run: string; readonly declined: string; readonly answered: string };

export function amendmentOf(tag: Tag): Amendment | null {
  const bound = tag.contracts?.[AMENDMENT];
  const ops = bound?.slots.ops;
  const run = bound?.words.run;
  const declined = bound?.words.declined;
  const answered = bound?.words.answered;
  return ops === undefined || run === undefined || declined === undefined || answered === undefined
    ? null
    : { ops, run, declined, answered };
}
