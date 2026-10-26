<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import type { WorktreeAway } from './worktreeGroups.js';

  let { away, depth, onReveal }: { away: readonly WorktreeAway[]; depth: number; onReveal: (threadId: string) => void } = $props();

  const BASE_REM = 0.375;
  const INDENT_REM = 0.75;
  const GUTTER_REM = 0.875;
</script>

{#each away as place (place.row.rootId)}
  <div class="relative min-w-0">
    <span
      class="pointer-events-none absolute -top-px bottom-0 w-px bg-vein"
      style={`left: ${BASE_REM + depth * INDENT_REM + GUTTER_REM / 2}rem`}
    ></span>
    <button
      type="button"
      class="grid w-full grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-1.5 rounded-md py-1 pr-2 text-left text-small leading-4 text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:bg-selected focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
      style={`padding-left: ${BASE_REM + (depth + 1) * INDENT_REM}rem`}
      data-worktree-away={place.row.name}
      onclick={() => onReveal(place.threads[0] ?? '')}
    >
      <span class="grid size-3.5 place-items-center opacity-60"><ArrowRight class="size-3" /></span>
      <span class="flex min-w-0 items-center gap-1">
        <span class="shrink-0 tabular">{place.threads.length} {place.threads.length === 1 ? 'agent' : 'agents'} in</span>
        <WorktreeSwatch row={place.row} />
        <span class="min-w-0 truncate font-mono">{place.row.branch ?? place.row.name}</span>
      </span>
    </button>
  </div>
{/each}
