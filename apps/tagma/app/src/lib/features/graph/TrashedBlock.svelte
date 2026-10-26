<script lang="ts">
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { timeAgo } from '$lib/shared/time.js';

  let { name, store, restored }: { name: string; store: TreeScreen; restored?: () => void } = $props();

  const row = $derived(store.trashRoots.find((candidate) => candidate.name === name));
  let restoring = $state(false);

  async function restore(): Promise<void> {
    restoring = true;
    if (await store.restore(name)) restored?.();
    else restoring = false;
  }
</script>

<div class="grid h-full place-items-center px-6">
  <div class="flex max-w-sm flex-col items-center text-center">
    <span class="flex items-center gap-1.5 text-muted-foreground">
      <Trash2 class="size-3.5" />
      <span class="eyebrow">In the trash</span>
    </span>
    <h1 class="mt-2 text-page">{row === undefined ? 'This block is in the trash' : row.title.trim() || 'Untitled'}</h1>
    <p class="mt-2 flex items-center gap-1.5 text-muted-foreground">
      {#if row === undefined}<BlockName {name} />{/if}
      {#if row?.deletedAt}
        <span class="stamp tabular">deleted {timeAgo(row.deletedAt)}</span>
      {/if}
    </p>
    <Button class="mt-4" variant="outline" size="sm" disabled={restoring} onclick={() => void restore()}>
      {restoring ? 'Restoring…' : 'Restore'}
    </Button>
  </div>
</div>
