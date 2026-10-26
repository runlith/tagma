import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';

export type CommitRange = { readonly base: string; readonly head: string };

export type WorktreeLens = { readonly range: CommitRange | null };

export type ChangesLens = 'now' | 'history' | 'base';

export type OpenedFile = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly path: string;
  readonly commit: string | null;
  readonly lens?: WorktreeLens;
  readonly lines?: CheckoutLines;
};
