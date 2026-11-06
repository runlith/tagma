<script lang="ts">
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import Store from '@lucide/svelte/icons/store';
  import Tag from '@lucide/svelte/icons/tag';
  import SectionColumn from '$lib/app/panes/SectionColumn.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { HeldOrder } from '$lib/shared/HeldOrder.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import type { Here } from '$lib/features/plugins/here.js';
  import { idOf, type Place, samePlace } from '$lib/features/plugins/place.js';
  import { PluginsColumn } from '$lib/features/plugins/PluginsColumn.svelte.js';
  import { PluginsPlace } from '$lib/features/plugins/PluginsPlace.svelte.js';
  import { PLUGINS_SEAM } from '$lib/features/plugins/seams.js';
  import StateMark from '$lib/features/plugins/StateMark.svelte';
  import Tile from '$lib/features/plugins/Tile.svelte';

  const plugins = PluginsPlace.use();
  const column = PluginsColumn.use();
  $effect(() => plugins.hold());

  const here = $derived(plugins.here);
  const categories = $derived(plugins.categories);
  const marketplaces = $derived(plugins.feed.marketplaces);
  const listed = $derived(plugins.listings.length);
  const failure = $derived(plugins.failure);
  const place = $derived(plugins.place);
  const hrefOf = (id: string | null): string => plugins.hrefOf(id);

  const placeOfHere = (item: Here): Place =>
    item.kind === 'plugin' ? { kind: 'plugin', id: item.row.id } : { kind: 'server', scope: item.row.scope, name: item.row.name };
  const categoryPlace = (name: string): Place => ({ kind: 'category', name });
  const sourcePlace = (id: string): Place => ({ kind: 'source', id });
  const all = $derived(place.kind === 'catalog');

  const order = new HeldOrder<readonly string[]>(() => here.map((item) => item.key));
  const shown = $derived.by(() => {
    const byKey = new Map(here.map((item) => [item.key, item]));
    return order.shown.flatMap((key) => byKey.get(key) ?? []);
  });
  const builtin = (item: Here): boolean => item.kind === 'plugin' && item.row.builtin;
  const installed = $derived(shown.filter((item) => !builtin(item)));
  const built = $derived(shown.filter(builtin));

  const ROW = 'relative flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-ui transition-colors';
  const rowClass = (current: boolean, quiet = false) => [
    ROW,
    current ? 'bg-selected text-foreground' : quiet ? 'text-muted-foreground hover:bg-hover' : 'text-foreground hover:bg-hover',
  ];
</script>

{#snippet mark(current: boolean)}
  {#if current}<span class="absolute inset-y-1.5 -left-2 w-0.5 bg-brand" aria-hidden="true"></span>{/if}
{/snippet}

{#snippet hereRow(item: Here)}
  {@const at = placeOfHere(item)}
  {@const current = samePlace(at, place)}
  <a href={hrefOf(idOf(at))} aria-current={current ? 'page' : undefined} class={rowClass(current, item.state === 'off')}>
    {@render mark(current)}
    <Tile title={item.title} size="sm" />
    <FadeText text={item.title} class="flex-1" />
    <StateMark state={item.state} />
  </a>
{/snippet}

<SectionColumn
  geometry={PLUGINS_SEAM}
  label="Plugins"
  resize="Resize the plugins column"
  onCollapse={() => column.toggle()}
  class="min-h-0 overflow-hidden"
>
  <div class="flex h-12 shrink-0 items-center justify-between border-b pr-2 pl-4">
    <h1 class="eyebrow text-muted-foreground">Plugins</h1>
    <Tooltip text="Add by address">
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Add by address"
        onclick={() => (plugins.adding = true)}
      >
        <Plus class="size-4" />
      </button>
    </Tooltip>
  </div>

  <nav class="grid min-h-0 flex-1 content-start overflow-y-auto px-3 pb-6" aria-label="Plugin places">
    <div role="presentation" class="grid" onpointerenter={() => order.enter()} onpointerleave={() => order.leave()}>
      <p class="eyebrow flex items-baseline px-2 pt-3 pb-1 text-muted-foreground/70">
        <span class="flex-1">In this project</span>
        {#if installed.length > 0}<span class="stamp tabular">{installed.length}</span>{/if}
      </p>
      {#each installed as item (item.key)}
        {@render hereRow(item)}
      {:else}
        {#if failure === null}
          <p class="px-2 pb-1 text-small text-muted-foreground">Nothing yet. Add a plugin from the catalog below.</p>
        {/if}
      {/each}
      {#if failure !== null}
        <p class="px-2 pb-1 text-small text-destructive">Could not be read: {failure}</p>
      {/if}

      {#if built.length > 0}
        <p class="eyebrow flex items-baseline px-2 pt-4 pb-1 text-muted-foreground/70">
          <span class="flex-1">Built into Tagma</span>
          <span class="stamp tabular">{built.length}</span>
        </p>
        {#each built as item (item.key)}
          {@render hereRow(item)}
        {/each}
      {/if}
    </div>

    <p class="eyebrow px-2 pt-4 pb-1 text-muted-foreground/70">Browse</p>
    <a href={hrefOf(null)} aria-current={all ? 'page' : undefined} class={rowClass(all)}>
      {@render mark(all)}
      <LayoutGrid class="size-4 shrink-0 text-muted-foreground" />
      <FadeText text="All plugins" class="flex-1" />
      <span class="stamp tabular text-muted-foreground/70">{listed}</span>
    </a>
    {#each categories as category (category.name)}
      {@const at = categoryPlace(category.name)}
      {@const current = samePlace(at, place)}
      <a href={hrefOf(idOf(at))} aria-current={current ? 'page' : undefined} class={rowClass(current)}>
        {@render mark(current)}
        <Tag class="size-4 shrink-0 text-muted-foreground" />
        <FadeText text={category.name} class="flex-1" />
        <span class="stamp tabular text-muted-foreground/70">{category.count}</span>
      </a>
    {/each}

    {#if marketplaces.length > 0}
      <p class="eyebrow px-2 pt-4 pb-1 text-muted-foreground/70">Sources</p>
      {#each marketplaces as marketplace (marketplace.id)}
        {@const at = sourcePlace(marketplace.id)}
        {@const current = samePlace(at, place)}
        <a href={hrefOf(idOf(at))} aria-current={current ? 'page' : undefined} class={rowClass(current)}>
          {@render mark(current)}
          <Store class="size-4 shrink-0 text-muted-foreground" />
          <FadeText text={marketplace.title} class="flex-1" />
          {#if marketplace.failure !== null && marketplace.revision === null}
            <span class="size-2 shrink-0 bg-destructive" role="img" aria-label="Its list could not be fetched"></span>
          {:else}
            <span class="stamp tabular text-muted-foreground/70">{marketplace.entries}</span>
          {/if}
        </a>
      {/each}
    {/if}
  </nav>
</SectionColumn>
