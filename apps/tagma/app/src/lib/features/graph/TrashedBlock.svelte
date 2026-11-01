<script lang="ts">
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import type { DiffRange } from '$lib/features/workspace/address.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { timeAgo } from '$lib/shared/time.js';
  import { toldOf } from '$lib/wire/refusal.js';

  let {
    name,
    store,
    range = null,
    restored,
  }: { name: string; store: TreeScreen; range?: DiffRange | null; restored?: () => void } = $props();

  const blocks = BlocksRepo.use();
  const listed = $derived(store.trash(name));
  const resolved = $derived(listed === undefined ? blocks.trashRoot.key(name) : undefined);
  const row = $derived(listed ?? resolved?.data ?? undefined);
  const journal = $derived(range?.kind === 'range' ? blocks.diff.key({ name, from: range.from, to: range.to ?? undefined }) : undefined);
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
    {#if resolved?.error}
      <p class="mt-4 text-small text-muted-foreground">{toldOf(resolved.error).text}</p>
    {/if}
    {#if journal?.data}
      <div class="mt-4 w-full text-left">
        <BlockDiffCard diff={journal.data.diff} marks={journal.data.marks} blocks={journal.data.blocks} />
      </div>
    {:else if journal?.error}
      <p class="mt-4 text-small text-muted-foreground">{toldOf(journal.error).text}</p>
    {:else if journal}
      <Waiting class="mt-4 size-4" />
    {/if}
  </div>
</div>
