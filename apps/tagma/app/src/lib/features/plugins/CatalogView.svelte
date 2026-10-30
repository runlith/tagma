<script lang="ts">
  import type { MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
  import Search from '@lucide/svelte/icons/search';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { type Listing, matching, titleOf } from '$lib/features/plugins/catalog.js';
  import ListingRow from '$lib/features/plugins/ListingRow.svelte';
  import { idOf, type Place } from '$lib/features/plugins/place.js';
  import SourceHead from '$lib/features/plugins/SourceHead.svelte';
  import Tile from '$lib/features/plugins/Tile.svelte';
  import { KINDS } from '$lib/features/plugins/words.js';

  let {
    listings,
    marketplaces,
    known,
    place,
    hrefOf,
    onremoved,
  }: {
    listings: readonly Listing[];
    marketplaces: readonly MarketplaceRow[];
    known: boolean;
    place: Place;
    hrefOf: (id: string | null) => string;
    onremoved: () => void;
  } = $props();

  let query = $state('');

  const source = $derived(place.kind === 'source' ? marketplaces.find((marketplace) => marketplace.id === place.id) : undefined);
  const scoped = $derived(
    place.kind === 'category'
      ? listings.filter(({ entry }) => entry.category === place.name)
      : place.kind === 'source'
        ? listings.filter(({ entry, also }) => entry.marketplace === place.id || also.some((one) => one.marketplace === place.id))
        : listings,
  );
  const shown = $derived(matching(scoped, query));
  const featured = $derived(
    place.kind === 'catalog' && query.trim() === '' ? listings.filter((listing) => listing.marketplace?.label === 'tagma') : [],
  );
  const rest = $derived(featured.length === 0 ? shown : shown.filter((listing) => !featured.includes(listing)));
  const heading = $derived(place.kind === 'category' ? place.name : 'All plugins');
  const entryHref = (listing: Listing) => hrefOf(idOf({ kind: 'entry', marketplace: listing.entry.marketplace, name: listing.entry.name }));
</script>

<div class="mx-auto grid w-full max-w-5xl content-start gap-6 px-8 py-6">
  {#if source !== undefined}
    <SourceHead marketplace={source} {onremoved} />
  {:else}
    <header class="grid gap-1">
      <h2 class="text-title font-semibold">{heading}</h2>
      <p class="text-ui text-muted-foreground">
        What you add here, agents in this project can use: services they reach, skills they follow, agents and commands.
      </p>
    </header>
  {/if}

  <div class="relative">
    <Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input class="pl-8" placeholder="Search plugins" bind:value={query} aria-label="Search plugins" />
  </div>

  {#if !known}
    <div class="flex items-center gap-2 text-ui text-muted-foreground"><Waiting class="size-3" />Reading the sources</div>
  {:else if marketplaces.length === 0}
    <p class="text-ui text-muted-foreground">No source is added. Add one by its address with the plus beside Plugins.</p>
  {:else}
    {#if featured.length > 0}
      <section class="grid gap-2" aria-label="Made by Tagma">
        <h3 class="text-ui font-semibold">Made by Tagma</h3>
        <div class="grid grid-cols-3 gap-3">
          {#each featured as listing (`${listing.entry.marketplace}/${listing.entry.name}`)}
            <a
              href={entryHref(listing)}
              class="grid content-start gap-3 rounded-lg border bg-raised p-4 transition-colors select-none hover:bg-hover"
            >
              <span class="flex min-w-0 items-center gap-3">
                <Tile title={titleOf(listing.entry)} />
                <FadeText text={titleOf(listing.entry)} class="text-body font-semibold" />
              </span>
              <FadeText text={listing.entry.description ?? ''} class="text-small text-muted-foreground" />
              <span class="flex flex-wrap gap-1">
                {#each listing.entry.brings as kind (kind)}
                  <span class="rounded-sm bg-hover px-1.5 text-meta text-muted-foreground">{KINDS[kind]}</span>
                {/each}
                {#if listing.entry.state === 'installed'}<span class="text-meta text-muted-foreground">Installed</span>{/if}
              </span>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <section class="grid gap-1" aria-label="Plugins">
      {#if featured.length > 0}<h3 class="pb-1 text-ui font-semibold">Everything</h3>{/if}
      {#if rest.length === 0}
        <p class="text-ui text-muted-foreground">{query.trim() === '' ? 'This source lists no plugin.' : 'No plugin matches.'}</p>
      {:else}
        <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {#each rest as listing (`${listing.entry.marketplace}/${listing.entry.name}`)}
            <ListingRow {listing} href={entryHref(listing)} />
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
