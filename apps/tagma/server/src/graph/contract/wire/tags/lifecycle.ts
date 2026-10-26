import type { ContractId } from './behaviour.js';
import type { Tag } from './declaration.js';

export const LIFECYCLE: ContractId = 'core/lifecycle';

export type Lifecycle = {
  readonly field: string;
  readonly initial: string;
  readonly claimed?: string;
  readonly done?: string;
  readonly closed?: string;
};

export function lifecycleOf(tag: Tag): Lifecycle | null {
  const bound = tag.contracts?.[LIFECYCLE];
  const field = bound?.slots.status;
  const initial = bound?.words.initial;
  if (bound === undefined || field === undefined || initial === undefined) return null;
  const { claimed, done, closed } = bound.words;
  return {
    field,
    initial,
    claimed,
    done,
    closed,
  };
}
