<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import { type Listing, titleOf } from '$lib/features/plugins/catalog.js';
  import Tile from '$lib/features/plugins/Tile.svelte';
  import { originOf } from '$lib/features/plugins/words.js';

  let { listing, href }: { listing: Listing; href: string } = $props();

  const title = $derived(titleOf(listing.entry));
  const installed = $derived(listing.entry.state === 'installed' || listing.entry.state === 'taken');
</script>

<a {href} class="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md p-2 transition-colors select-none hover:bg-hover">
  <Tile {title} />
  <span class="grid min-w-0 gap-0.5">
    <FadeText text={title} class="text-ui font-medium" />
    <FadeText text={listing.entry.description ?? listing.entry.category ?? ''} class="text-small text-muted-foreground" />
  </span>
  <span class="flex shrink-0 items-center gap-2 text-meta text-muted-foreground">
    {#if installed}
      Installed
    {:else if listing.marketplace?.label === 'unreviewed'}
      <span class="rounded-sm border px-1.5">Unreviewed</span>
    {:else if listing.marketplace !== undefined}
      {originOf(listing.marketplace)}
    {/if}
  </span>
</a>
