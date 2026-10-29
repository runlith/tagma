<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { EntryRow, MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import Search from '@lucide/svelte/icons/search';
  import { Input } from '$lib/shared/ui/input/index.js';
  import EntryCard from '$lib/features/plugins/EntryCard.svelte';

  let {
    marketplaces,
    entries,
    project,
    scope,
    oninstalled,
  }: {
    marketplaces: readonly MarketplaceRow[];
    entries: readonly EntryRow[];
    project: Project;
    scope: SettableScope;
    oninstalled: () => Promise<unknown>;
  } = $props();

  let query = $state('');
  let only = $state<string | null>(null);

  const byId = $derived(new Map(marketplaces.map((marketplace) => [marketplace.id, marketplace])));
  const rank = $derived(new Map(marketplaces.map((marketplace, at) => [marketplace.id, at])));
  const ordered = $derived(
    entries.toSorted((a, b) => (rank.get(a.marketplace) ?? marketplaces.length) - (rank.get(b.marketplace) ?? marketplaces.length)),
  );
  const words = $derived(
    query
      .trim()
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word !== ''),
  );
  const shown = $derived(
    ordered.filter((entry) => {
      if (only !== null && entry.marketplace !== only) return false;
      if (words.length === 0) return true;
      const text = [entry.name, entry.title, entry.description, entry.category, entry.author].join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    }),
  );
</script>

<div class="grid gap-2">
  <div class="relative">
    <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input class="pl-8" placeholder="Search plugins" bind:value={query} aria-label="Search plugins" />
  </div>
  {#if marketplaces.length > 1}
    <div class="flex flex-wrap items-center gap-1 text-small" role="group" aria-label="Marketplace">
      {#each [null, ...marketplaces.map((marketplace) => marketplace.id)] as id (id ?? '')}
        <button
          type="button"
          class={['rounded-md px-2 py-0.5 transition-colors hover:bg-hover', only === id && 'bg-selected']}
          aria-pressed={only === id}
          onclick={() => (only = id)}
        >
          {id === null ? 'All' : (byId.get(id)?.title ?? id)}
        </button>
      {/each}
    </div>
  {/if}

  {#if shown.length === 0}
    <p class="text-ui text-muted-foreground">
      {entries.length === 0 ? 'The marketplaces list no plugins yet.' : 'No plugin matches.'}
    </p>
  {/if}
  {#each shown as entry (`${entry.marketplace}/${entry.name}`)}
    <EntryCard {entry} marketplace={byId.get(entry.marketplace)} {project} {scope} {oninstalled} />
  {/each}
</div>
