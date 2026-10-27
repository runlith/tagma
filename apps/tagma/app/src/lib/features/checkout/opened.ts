import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';

export type CommitRange = { readonly base: string; readonly head: string };

export type WorktreeLens = { readonly range: CommitRange | null };

export type ChangesLens = 'now' | 'history' | 'base';

export type OpenedDiff = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly path: string;
  readonly commit: string | null;
  readonly lens?: WorktreeLens;
  readonly lines?: CheckoutLines;
};

export type OpenedDisk = { readonly projectId: number; readonly rootId: null; readonly path: string; readonly commit: null };

export type OpenedFile = OpenedDiff | OpenedDisk;

export const diffOf = (open: OpenedFile | null): OpenedDiff | null => (open === null || open.rootId === null ? null : open);
