<script lang="ts">
  import { untrack } from 'svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Router } from '@runlith/layer/Router';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { McpFeed } from '$lib/features/mcp/Feed.js';
  import { McpRepo } from '$lib/features/mcp/Repo.js';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import AddDialog from '$lib/features/plugins/AddDialog.svelte';
  import { categoriesOf, listingsOf } from '$lib/features/plugins/catalog.js';
  import CatalogView from '$lib/features/plugins/CatalogView.svelte';
  import EntryPage from '$lib/features/plugins/EntryPage.svelte';
  import { MarketplacesFeed } from '$lib/features/plugins/Feed.svelte.js';
  import { hereOf } from '$lib/features/plugins/here.js';
  import { PLUGINS, placeOf } from '$lib/features/plugins/place.js';
  import PlaceList from '$lib/features/plugins/PlaceList.svelte';
  import PluginPage from '$lib/features/plugins/PluginPage.svelte';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import ServerPage from '$lib/features/plugins/ServerPage.svelte';

  let { opened }: { opened: string | null } = $props();

  const workspace = Workspace.use();
  const addresses = Addresses.use();
  const router = Router.use();
  const feed = MarketplacesFeed.use();
  const mcpFeed = McpFeed.use();
  const plugins = PluginsRepo.use();
  const mcp = McpRepo.use();
  const secrets = SecretsRepo.use();

  const project = $derived(workspace.contextProject);
  const projectId = $derived(project?.id);

  $effect(() => feed.hold());
  $effect(() => {
    if (projectId !== undefined) return mcpFeed.hold(projectId);
  });

  const section = App.section('plugins', 'app');
  let catalogLife: ReturnType<typeof section.child> | null = null;
  let catalog = $state<SettingsCatalog | null>(null);

  $effect(() => {
    const id = projectId;
    untrack(() => {
      if (id === catalog?.projectId) return;
      const leaving = catalogLife;
      catalogLife = id === undefined ? null : section.child('plugin-options');
      catalog = id === undefined || catalogLife === null ? null : SettingsCatalog.start(catalogLife, { projectId: id });
      if (leaving !== null) void leaving.close();
    });
  });

  const listed = $derived(projectId === undefined ? undefined : plugins.plugins.key(projectId));
  const served = $derived(projectId === undefined ? undefined : mcp.servers.key(projectId));
  const rows = $derived(listed?.data ?? []);
  const servers = $derived(served?.data ?? []);

  const listings = $derived(listingsOf(feed.marketplaces, feed.entries));
  const categories = $derived(categoriesOf(listings));
  const here = $derived(hereOf(rows, servers, feed.entries));
  const place = $derived(placeOf(opened));

  const hrefOf = (id: string | null): string => (project === null ? '' : addresses.place(project.name, PLUGINS, id, null));
  const go = (id: string | null) => void router.goto(hrefOf(id));

  async function refreshed(): Promise<void> {
    if (projectId === undefined) return;
    await Promise.all([
      plugins.plugins.key(projectId).refresh(),
      mcp.servers.key(projectId).refresh(),
      secrets.sets.key({ projectId, owner: 'plugins' }).refresh(),
      catalog?.load(),
    ]);
  }

  let adding = $state(false);
</script>

{#if project !== null}
  <div class="flex h-full min-h-0 min-w-0">
    <PlaceList
      {here}
      {categories}
      marketplaces={feed.marketplaces}
      listed={listings.length}
      {place}
      {hrefOf}
      onadd={() => (adding = true)}
    />
    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="Plugins">
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
          <p class="px-8 py-6 text-ui text-muted-foreground">{feed.known ? 'No source lists this plugin now.' : 'Reading the sources…'}</p>
        {/if}
      {:else if place.kind === 'plugin'}
        {@const item = here.find((one) => one.kind === 'plugin' && one.row.id === place.id)}
        {#if item !== undefined && item.kind === 'plugin'}
          <PluginPage {item} {project} {catalog} onchanged={refreshed} onremoved={() => go(null)} />
        {:else}
          <p class="px-8 py-6 text-ui text-muted-foreground">
            {listed?.isPending ? 'Reading the plugins…' : 'This plugin is not installed.'}
          </p>
        {/if}
      {:else if place.kind === 'server'}
        {@const row = servers.find((one) => one.scope === place.scope && one.name === place.name)}
        {#if row !== undefined}
          <ServerPage {row} {project} onremoved={() => go(null)} />
        {:else}
          <p class="px-8 py-6 text-ui text-muted-foreground">
            {served?.isPending ? 'Reading the servers…' : 'No server of that name is declared.'}
          </p>
        {/if}
      {:else}
        <CatalogView {listings} marketplaces={feed.marketplaces} known={feed.known} {place} {hrefOf} onremoved={() => go(null)} />
      {/if}
    </main>
  </div>
  <AddDialog
    bind:open={adding}
    {project}
    ondone={async (at) => {
      await refreshed();
      if (at !== null) go(at);
    }}
  />
{/if}
