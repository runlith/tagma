import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { CheckoutHoldings } from '../contract/service/checkouts.js';
import type { CheckoutHolder, CheckoutState } from '../contract/wire/checkout.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';

export const rowHolders = (
  row: CheckoutState,
  holdings: CheckoutHoldings['Service'],
): Effect.Effect<ReadonlyMap<string, readonly CheckoutHolder[]>, StoreFailure | RootResolutionFailure> => {
  const areas = [row.entries.staged, row.entries.unstaged, row.entries.untracked, row.entries.unmerged];
  const paths = [...new Set(areas.flatMap((area) => area.entries.map((entry) => entry.path)))];
  return paths.length === 0 ? Effect.succeed(new Map()) : holdings.holdersOf(row.rootId, paths);
};
