<script lang="ts">
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import type { WorktreeMove } from './worktreeMove.js';

  let { move, places }: { move: WorktreeMove; places: Worktrees } = $props();

  const row = $derived(places.byRoot(move.rootId));
  const tone = $derived(toneOf(row));
  const name = $derived(row === null ? 'a worktree no longer listed' : (row.branch ?? row.name));
  const verb = $derived(move.status === 'pending' ? 'Moving to' : move.status === 'published' ? 'Moved to' : 'Not moved to');
</script>

<div
  class={[
    'move-card my-1 grid max-w-xl gap-1 rounded-lg border bg-raised px-3 py-2 text-ui',
    move.status === 'denied' && 'move-card--denied',
  ]}
  style={tone === null ? undefined : `--tone: ${tone}`}
  data-worktree-move={move.status}
>
  <div class="flex min-w-0 items-center gap-2">
    {#if move.status === 'denied'}
      <TriangleAlert class="size-3.5 shrink-0 text-destructive" />
    {:else}
      <ArrowRightLeft class="size-3.5 shrink-0 text-muted-foreground" />
    {/if}
    <span class="shrink-0 font-medium">{verb}</span>
    <span
      class={[
        'move-chip inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-meta',
        move.status === 'pending' && 'move-chip--pending',
      ]}
    >
      <WorktreeSwatch {row} />
      <span class="min-w-0 truncate">{name}</span>
    </span>
  </div>
  {#if move.status === 'pending'}
    <p class="text-small text-muted-foreground">Takes effect at the run's next step; the step in flight stays where it is.</p>
  {:else if move.status === 'denied' && move.detail !== null}
    <p class="text-small text-muted-foreground">{move.detail}</p>
  {/if}
</div>

<style>
  .move-card {
    border-left: 3px solid var(--tone, var(--color-border));
  }
  .move-card--denied {
    border-left-color: var(--color-destructive);
  }
  .move-chip {
    background: color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 12%, transparent);
  }
  .move-chip--pending {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 16%, transparent) 0 6px,
      transparent 6px 11px
    );
  }
</style>
