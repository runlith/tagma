<script lang="ts">
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import EventCard from './EventCard.svelte';
  import type { WorktreeMove } from './worktreeMove.js';

  let { move, places }: { move: WorktreeMove; places: Worktrees } = $props();

  const row = $derived(places.byRoot(move.rootId));
  const name = $derived(row === null ? 'a worktree no longer listed' : (row.branch ?? row.name));
  const verb = $derived(move.status === 'pending' ? 'Moving to' : move.status === 'published' ? 'Moved to' : 'Not moved to');
  const outcome = $derived(move.status === 'pending' ? 'pending' : move.status === 'denied' ? 'failed' : 'done');
</script>

<EventCard {outcome} {verb} {row} {name} data-worktree-move={move.status}>
  {#if move.status === 'pending'}
    <p class="text-small text-muted-foreground">Takes effect at the run's next step; the step in flight stays where it is.</p>
  {:else if move.status === 'denied' && move.detail !== null}
    <p class="text-small text-muted-foreground">{move.detail}</p>
  {/if}
</EventCard>
