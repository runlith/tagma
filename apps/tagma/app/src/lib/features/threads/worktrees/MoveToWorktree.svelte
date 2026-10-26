<script lang="ts">
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  let { places, thread }: { places: Worktrees; thread: string } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="flex max-w-full min-w-0 items-center gap-1 rounded-sm pb-0.5 pl-8 pr-2 text-left text-small text-muted-foreground/80 hover:text-foreground disabled:opacity-50"
    disabled={places.moving.includes(thread)}
    data-thread-place-nowhere={thread}
  >
    <ArrowRightLeft class="size-3 shrink-0" />
    <span class="min-w-0 truncate">Move to a worktree</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="min-w-56">
    {#each places.rows.filter((one) => !one.missing && (one.kind === 'main' || one.branch !== null)) as target (target.rootId)}
      <DropdownMenu.Item onSelect={() => void places.move(thread, target.rootId)}>
        {#snippet lead()}<WorktreeSwatch row={target} />{/snippet}
        <span class="font-mono text-small">{target.branch ?? target.name}</span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
