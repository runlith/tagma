<script lang="ts">
  import { untrack } from 'svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import AddDialog from '$lib/features/plugins/AddDialog.svelte';
  import CatalogView from '$lib/features/plugins/CatalogView.svelte';
  import EntryPage from '$lib/features/plugins/EntryPage.svelte';
  import PluginPage from '$lib/features/plugins/PluginPage.svelte';
  import { PluginsPlace } from '$lib/features/plugins/PluginsPlace.svelte.js';
  import ServerPage from '$lib/features/plugins/ServerPage.svelte';

  const plugins = PluginsPlace.use();

  $effect(() => plugins.hold());

  const section = App.section('plugins', 'app');
  let catalogLife: ReturnType<typeof section.child> | null = null;
  let catalog = $state<SettingsCatalog | null>(null);

  $effect(() => {
    const id = plugins.projectId;
    untrack(() => {
      if (id === catalog?.projectId) return;
      const leaving = catalogLife;
      catalogLife = section.child('plugin-options');
      catalog = SettingsCatalog.start(catalogLife, { projectId: id });
      if (leaving !== null) void leaving.close();
    });
  });

  const project = $derived(plugins.project);
  const rows = $derived(plugins.rows);
  const servers = $derived(plugins.servers);
  const listings = $derived(plugins.listings);
  const place = $derived(plugins.place);

  const hrefOf = (id: string | null): string => plugins.hrefOf(id);

  async function refreshed(): Promise<void> {
    await Promise.all([plugins.refresh(), catalog?.load()]);
  }
</script>

{#if project !== null}
  {#key plugins.opened}
    {#if place.kind === 'entry'}
      {@const listing = listings.find(
        ({ entry, also }) =>
          (entry.marketplace === place.marketplace && entry.name === place.name) ||
          also.some((one) => one.marketplace === place.marketplace && one.name === place.name),
      )}
      {#if listing !== undefined}
        {@const exact =
          listing.entry.marketplace === place.marketplace
            ? listing
            : { ...listing, entry: listing.also.find((one) => one.marketplace === place.marketplace) ?? listing.entry }}
        <EntryPage listing={exact} {project} plugins={rows} {servers} {hrefOf} onadded={refreshed} />
      {:else}
        <p class="px-8 py-6 text-ui text-muted-foreground">
          {plugins.feed.known ? 'No source lists this plugin now.' : 'Reading the sources…'}
        </p>
      {/if}
    {:else if place.kind === 'plugin'}
      {@const item = plugins.here.find((one) => one.kind === 'plugin' && one.row.id === place.id)}
      {#if item !== undefined && item.kind === 'plugin'}
        <PluginPage {item} {project} {catalog} onchanged={refreshed} onremoved={() => plugins.go(null)} />
      {:else if plugins.pluginsFailure !== null}
        <div class="px-8 py-6"><Callout tone="error" title="The plugins could not be read" note={plugins.pluginsFailure} /></div>
      {:else}
        <p class="px-8 py-6 text-ui text-muted-foreground">
          {plugins.listed.isPending ? 'Reading the plugins…' : 'This plugin is not installed.'}
        </p>
      {/if}
    {:else if place.kind === 'server'}
      {@const row = servers.find((one) => one.scope === place.scope && one.name === place.name)}
      {#if row !== undefined}
        <ServerPage {row} {project} onremoved={() => plugins.go(null)} />
      {:else if plugins.serversFailure !== null}
        <div class="px-8 py-6"><Callout tone="error" title="The servers could not be read" note={plugins.serversFailure} /></div>
      {:else}
        <p class="px-8 py-6 text-ui text-muted-foreground">
          {plugins.served.isPending ? 'Reading the servers…' : 'No server of that name is declared.'}
        </p>
      {/if}
    {:else}
      <CatalogView
        {listings}
        marketplaces={plugins.feed.marketplaces}
        known={plugins.feed.known}
        {place}
        {hrefOf}
        onremoved={() => plugins.go(null)}
      />
    {/if}
  {/key}
  <AddDialog
    bind:open={plugins.adding}
    {project}
    ondone={async (at) => {
      await refreshed();
      if (at !== null) plugins.go(at);
    }}
  />
{/if}
