<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { currentBranch } from '$lib/features/workspace/address.js';
  import { currentCommit, currentGitView } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import WorktreeBoard from '$lib/features/worktrees/WorktreeBoard.svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import { Bar } from '$lib/app/panes/Bar.svelte.js';
  import { Topics } from '$lib/shared/threads/Topics.svelte.js';
  import CheckoutPage from './CheckoutPage.svelte';
  import { headOf } from './reading.js';
  import { Checkout } from './Selection.svelte.js';

  const worktrees = Worktrees.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const checkout = Checkout.use();
  const topics = Topics.use();
  const bar = Bar.use();

  $effect(() =>
    topics.offer(() => {
      const row = checkout.row;
      return { kind: 'text', text: `About the checkout${row === null || !row.repository ? '' : ` at ${headOf(row)}`}: ` };
    }),
  );

  $effect(() =>
    bar.name(() => {
      const row = checkout.row;
      return row === null ? null : headOf(row);
    }),
  );

  const view = $derived.by(() => {
    const asked = currentGitView(router);
    const named = asked === 'tree' || (asked === null && (currentBranch(router) !== null || currentCommit(router) !== null));
    if (named) return 'tree';
    if (!worktrees.known && worktrees.unread === null) return null;
    return worktrees.several ? 'board' : 'tree';
  });
</script>

{#if view === 'board'}
  <WorktreeBoard />
{:else if view === 'tree'}
  <CheckoutPage onBoard={worktrees.several ? () => void router.goto(addresses.git('board', currentBranch(router))) : undefined} />
{/if}
