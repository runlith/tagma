<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { WorktreeCreation, Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';

  let { places, creation }: { places: Worktrees; creation: WorktreeCreation } = $props();

  const PHASE = { preparing: 'preparing', checkout: 'checking out' } as const;
</script>

<div class="mt-1.5 grid min-w-0 gap-0.5 rounded-md px-1.5 py-1 text-small" data-worktree-creating={creation.phase}>
  <div class="grid grid-cols-[0.875rem_auto_minmax(0,1fr)_auto] items-center gap-x-1.5">
    {#if creation.phase === 'failed'}
      <TriangleAlert class="size-3.5 text-destructive" />
    {:else}
      <Waiting class="size-3.5 text-muted-foreground" />
    {/if}
    <WorktreeSwatch row={null} />
    <span class="min-w-0 truncate font-mono text-foreground/80">{creation.label}</span>
    {#if creation.phase === 'failed'}
      <span class="flex shrink-0 items-center gap-1 text-small">
        {#if creation.retry !== null}
          <button
            type="button"
            class="rounded-sm px-1 text-foreground/80 hover:bg-hover hover:text-foreground"
            onclick={() => creation.retry?.()}>Retry</button
          >
        {/if}
        <button
          type="button"
          class="rounded-sm px-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          onclick={() => places.dismiss(creation.id)}>Dismiss</button
        >
      </span>
    {:else}
      <span class="shrink-0 text-small text-muted-foreground">{PHASE[creation.phase]}</span>
    {/if}
  </div>
  {#if creation.problem !== null}
    <p class="pl-6 text-small leading-snug text-destructive/90">{creation.problem}</p>
  {/if}
</div>
