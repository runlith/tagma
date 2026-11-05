type Continuation = { readonly _tag: 'Continues' } | { readonly _tag: 'Diverges'; readonly detail: string };

export type CandidateChain = Continuation | { readonly _tag: 'Unread'; readonly detail: string };

export type Applied = { readonly name: string | null; readonly hash: string };

export const continuation = (
  applied: ReadonlyArray<Applied>,
  chain: ReadonlyArray<{ readonly name?: string; readonly hash: string }>,
): Continuation => {
  if (chain.length < applied.length)
    return { _tag: 'Diverges', detail: `this store applied ${applied.length} migrations and the chain holds ${chain.length}` };
  const parted = applied.findIndex(
    (one, index) =>
      one.hash !== chain[index]!.hash || (one.name !== null && chain[index]!.name !== undefined && one.name !== chain[index]!.name),
  );
  return parted === -1
    ? { _tag: 'Continues' }
    : { _tag: 'Diverges', detail: `applied migration ${applied[parted]!.name ?? parted} is not migration ${parted} of the chain` };
};
