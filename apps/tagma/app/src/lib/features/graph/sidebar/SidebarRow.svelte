<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import type { ListedBlock } from '@tagma/server/graph/contract/wire/rows';
  import BlockRow from '$lib/features/graph/outline/BlockRow.svelte';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';

  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  let {
    block,
    project,
    childCount,
    attributes,
    class: className,
    leading,
    trailing,
  }: {
    block: ListedBlock;
    project: string;
    childCount?: number;
    attributes?: HTMLAnchorAttributes;
    class?: string;
    leading?: Snippet;
    trailing?: Snippet;
  } = $props();

  const href = $derived(addresses.block(block.name, { project }));
  const label = $derived(block.title.trim() || 'Untitled');
</script>

<BlockRow {block} {href} {childCount} layout="compact" {attributes} class={className} {leading} {trailing}>
  {#snippet title()}
    <FadeText
      class={cn(
        'pointer-events-none flex-1 py-px text-body leading-6',
        (tags.isResting(block) || !block.title.trim()) && 'text-muted-foreground',
      )}
      text={label}
    />
  {/snippet}
</BlockRow>
