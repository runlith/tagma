import { Data, Effect } from 'effect';
import { rowHolders } from '../../workspace/checkouts/holders.js';
import type { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { CheckoutState } from '../../workspace/contract/wire/checkout.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';

const ON_BASE: ReadonlySet<string> = new Set(['base-dirty', 'base-not-checked-out']);

const ON_TREE: ReadonlySet<string> = new Set(['source-held', 'source-dirty', 'operation-in-progress', 'no-branch']);

const AREAS = ['staged', 'unstaged', 'untracked', 'unmerged'] as const;

export type Checkout = { readonly state: CheckoutState; readonly held: number };

export type Standing = { readonly tree: Checkout; readonly base: Checkout | null };

export class StandingUnread extends Data.TaggedError('StandingUnread')<{ readonly message: string }> {}

const stateOf = ({ state, held }: Checkout): string =>
  [
    state.ref ?? '',
    state.operation,
    `held:${held}`,
    ...AREAS.map((area) => {
      const at = state.entries[area];
      return `${area}:${at.entries.length}:${at.added}:${at.removed}`;
    }),
  ].join(' ');

export const basisOf = (code: string, { tree, base }: Standing): string =>
  [
    base?.state.head ?? '',
    tree.state.head ?? '',
    ON_BASE.has(code) && base !== null ? stateOf(base) : '',
    ON_TREE.has(code) ? stateOf(tree) : '',
  ].join('|');

export const readStanding = (checkouts: CheckoutRows['Service'], holdings: CheckoutHoldings['Service']) => {
  const read = Effect.fnUntraced(function* (root: RootId) {
    const state = yield* checkouts.read(root);
    if (state.stale || state.incomplete || !state.repository)
      return yield* new StandingUnread({ message: `the checkout of ${root} reads stale, incomplete or outside any git repository` });
    const holders = yield* rowHolders(state, holdings);
    return { state, held: [...holders.values()].filter((one) => one.length > 0).length } satisfies Checkout;
  });
  return Effect.fn('PendingMerges.standing')(function* (tree: RootId, base: RootId | null) {
    const at = yield* read(tree);
    return { tree: at, base: base === null ? null : yield* read(base) } satisfies Standing;
  });
};
