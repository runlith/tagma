import { Router } from '@runlith/layer/Router';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import type { AskPlace } from '$lib/features/threads/Asking.js';
import { currentBranch } from '$lib/features/workspace/address.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';

type RootId = NonNullable<Checkout['row']>['rootId'];

export type Here = { readonly ask: () => AskPlace | null; readonly root: () => RootId | undefined };

export const useHere = (): Here => {
  const workspace = Workspace.use();
  const checkout = Checkout.use();
  const router = Router.use();
  const root = (): RootId | undefined => checkout.row?.rootId;
  return {
    root,
    ask: () => {
      const projectId = workspace.contextProject?.id;
      if (projectId === undefined) return null;
      return { projectId, worktree: currentBranch(router) === null ? undefined : root() };
    },
  };
};
