import type { AccountKey } from '@runlith/llm/models/authStatus';

export type AccountChoice =
  | { readonly kind: 'chosen'; readonly account: AccountKey }
  | { readonly kind: 'unsigned' }
  | { readonly kind: 'ambiguous'; readonly keys: readonly AccountKey[] };

export const chooseAccount = (defaultAccount: AccountKey | null, stored: readonly AccountKey[]): AccountChoice => {
  if (defaultAccount !== null) return { kind: 'chosen', account: defaultAccount };
  const first = stored[0];
  if (first === undefined) return { kind: 'unsigned' };
  if (stored.length === 1) return { kind: 'chosen', account: first };
  return { kind: 'ambiguous', keys: [...stored].sort() };
};
