<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import X from '@lucide/svelte/icons/x';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import StatusChip from '$lib/features/graph/StatusChip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { timeAgo } from '$lib/shared/time.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const sessions = SessionRegistry.use();
  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  let { block, store, onClose }: { block: TreeBlock; store: TreeScreen; onClose: () => void } = $props();
</script>

<div
  class="absolute top-4 right-4 w-76 max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-raised"
>
  <div class="flex items-start gap-2 px-3 pt-2 pb-2">
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <TagIcon tag={tags.tagOf(block)} class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="eyebrow capitalize text-muted-foreground">{tags.word(tags.tagOf(block))}</span>
    </div>
    <Tooltip text="Close">
      <button
        type="button"
        class="-mt-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Close"
        onclick={onClose}
      >
        <X class="size-3.5" />
      </button>
    </Tooltip>
  </div>

  <p class={cn('px-3 pb-2 text-ui leading-snug font-medium', !block.title.trim() && 'text-muted-foreground')}>
    {block.title.trim() || 'Untitled'}
  </p>

  <div class="flex items-center gap-2 border-t bg-sunken/50 px-3 py-2">
    <StatusChip {block} {store} always />
    {#if tags.underway(block) && tags.holderOf(block) !== null}
      <WriterBadge writer={sessions.writerOf(tags.holderOf(block))} />
    {/if}
    <span class="stamp tabular ml-auto shrink-0 text-muted-foreground/70">{timeAgo(block.updatedAt)}</span>
    <Button variant="outline" size="xs" href={addresses.block(block.identity)}>
      Open
      <ArrowUpRight class="size-3" data-icon="inline-end" />
    </Button>
  </div>
</div>
