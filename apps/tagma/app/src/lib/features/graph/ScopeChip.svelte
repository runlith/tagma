<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  let {
    name,
    block,
    surface,
    class: className,
  }: { name: string; block?: TreeBlock; surface: 'graph' | 'journal'; class?: string } = $props();
</script>

<div class={cn('flex items-center gap-1 rounded-lg border bg-popover/90 p-1 pl-3 shadow-raised backdrop-blur-md', className)}>
  <span class="eyebrow shrink-0 text-muted-foreground">Scope</span>
  <Tooltip text="Open the block" class="block min-w-0">
    <a
      href={addresses.block(name)}
      class="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-ui transition-colors hover:bg-hover"
    >
      {#if block}
        <TagIcon tag={tags.tagOf(block)} class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="max-w-56 truncate">{block.title.trim() || 'Untitled'}</span>
      {:else}
        <BlockName {name} />
      {/if}
    </a>
  </Tooltip>
  <Tooltip text="Show the whole project">
    <Button href={addresses.surface(surface)} variant="quiet" size="icon-sm" class="rounded-lg" aria-label="Show the whole project">
      <X class="size-3.5" />
    </Button>
  </Tooltip>
</div>
