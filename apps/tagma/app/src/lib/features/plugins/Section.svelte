<script lang="ts">
  import type { PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import type { PluginOptionValues } from '@tagma/server/plugins/contract/wire/settings';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import { scopeName } from '$lib/features/settings/scope.js';
  import { McpFeed } from '$lib/features/mcp/Feed.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import { MarketplacesFeed } from '$lib/features/plugins/Feed.svelte.js';
  import Catalog from '$lib/features/plugins/Catalog.svelte';
  import Marketplaces from '$lib/features/plugins/Marketplaces.svelte';
  import PluginCard from '$lib/features/plugins/PluginCard.svelte';
  import { optionsWith } from '$lib/features/plugins/options.js';

  let { catalog, scope, project }: SectionProps = $props();

  const OPTIONS = 'plugins.options';
  const SECRET_OWNER = 'plugins';

  const repo = PluginsRepo.use();
  const secrets = SecretsRepo.use();
  const notices = Notices.use();
  const marketplacesFeed = MarketplacesFeed.use();
  const mcpFeed = McpFeed.use();

  const marketplaces = $derived(marketplacesFeed.marketplaces);
  const entries = $derived(marketplacesFeed.entries);

  $effect(() => marketplacesFeed.hold());

  const projectId = $derived(project?.id);

  $effect(() => {
    if (projectId !== undefined) return mcpFeed.hold(projectId);
  });
  const listed = $derived(projectId === undefined ? undefined : repo.plugins.key(projectId));
  const rows = $derived(listed?.data ?? []);
  const owned = $derived(projectId === undefined ? undefined : secrets.sets.key({ projectId, owner: SECRET_OWNER }));
  const sets = $derived(owned?.data ?? []);
  const secretsFailed = $derived(owned?.error);

  const optionsEntry = $derived(catalog.entriesOf('plugins').find((entry) => entry.id === OPTIONS));
  const values = $derived(
    (optionsEntry === undefined ? undefined : (catalog.answerOf(optionsEntry, 'user').own as PluginOptionValues | undefined)) ?? {},
  );
  const outcome = $derived(catalog.outcomes[OPTIONS]);

  let source = $state('');
  let busy = $state<string | null>(null);
  let writer = $state<string | null>(null);

  async function refreshed(id: number): Promise<void> {
    await Promise.all([repo.plugins.key(id).refresh(), secrets.sets.key({ projectId: id, owner: SECRET_OWNER }).refresh()]);
  }

  async function act(id: number, held: string, work: () => Promise<unknown>): Promise<void> {
    busy = held;
    try {
      await work();
      await refreshed(id);
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  function install(id: number): Promise<void> {
    const from = source.trim();
    return act(id, 'install', async () => {
      await repo.install.run({ projectId: id, source: from, scope }, { throwOnError: true });
      source = '';
    });
  }

  const setEnabled = (id: number, row: PluginRow, enabled: boolean) =>
    act(id, row.id, () => repo.enable.run({ projectId: id, id: row.id, enabled, scope }, { throwOnError: true }));

  const uninstall = (id: number, row: PluginRow) =>
    act(id, row.id, async () => {
      await repo.uninstall.run({ projectId: id, id: row.id }, { throwOnError: true });
      await catalog.load();
    });

  async function writeOption(id: number, row: PluginRow, key: string, value: string): Promise<boolean> {
    writer = row.id;
    busy = row.id;
    try {
      await catalog.write({ scope: 'user', key: OPTIONS, value: optionsWith(values, row.id, key, value) });
      if (catalog.outcomes[OPTIONS]?.kind !== 'saved') return false;
      await repo.plugins.key(id).refresh();
      return true;
    } finally {
      busy = null;
    }
  }
</script>

<div class="grid">
  {#if projectId === undefined}
    <p class="pt-4 text-ui text-muted-foreground">Plugins are read in a project: open this page from one.</p>
  {:else if project !== null}
    {@const id = projectId}
    <Group title="Catalog">
      {#snippet fact()}
        {#if entries.length > 0}
          <span class="tabular"
            >{entries.length}
            {entries.length === 1 ? 'plugin' : 'plugins'} in {marketplaces.length}
            {marketplaces.length === 1 ? 'marketplace' : 'marketplaces'}</span
          >
        {/if}
      {/snippet}
      <div class="grid gap-3 pt-1">
        {#if !marketplacesFeed.known}
          <p class="text-ui text-muted-foreground">Reading the marketplaces…</p>
        {:else if marketplaces.length === 0}
          <p class="text-ui text-muted-foreground">No marketplace is added. Add one under Marketplaces by its git URL or folder.</p>
        {:else}
          <Catalog {marketplaces} {entries} {project} {scope} oninstalled={() => refreshed(id)} />
        {/if}
      </div>
    </Group>

    <Group title="Installed">
      {#snippet fact()}
        {#if rows.length > 0}<span class="tabular">{rows.length} on this machine</span>{/if}
      {/snippet}

      <div class="grid gap-3 pt-1">
        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            if (source.trim() !== '') void install(id);
          }}
        >
          <Input class="font-mono" placeholder="A plugin folder or a git URL" bind:value={source} disabled={busy !== null} />
          <Button size="sm" type="submit" disabled={busy !== null || source.trim() === ''}>Install</Button>
        </form>
        <p class="text-small text-muted-foreground">What you install or switch on here runs in {scopeName(scope, project)}.</p>

        {#if listed?.error}
          <p class="text-ui text-destructive">
            The plugins could not be read: {listed.error instanceof Error ? listed.error.message : String(listed.error)}
          </p>
        {:else if listed?.isPending && rows.length === 0}
          <p class="text-ui text-muted-foreground">Reading the plugins…</p>
        {:else if rows.length === 0}
          <p class="text-ui text-muted-foreground">
            No plugin is installed yet. Install one from the catalog, or name a Claude Code, Codex or Agent Plugins package by its folder,
            read in place, or its git URL, cloned.
          </p>
        {/if}

        {#each rows as row (row.id)}
          <PluginCard
            {row}
            projectId={id}
            {scope}
            values={values[row.id] ?? {}}
            secrets={sets.find((set) => set.id === row.id)}
            {secretsFailed}
            busy={busy !== null}
            writing={busy !== null || catalog.busyKey === OPTIONS}
            refusal={writer === row.id && outcome?.kind === 'refused' ? outcome : undefined}
            onenabled={(enabled) => void setEnabled(id, row, enabled)}
            onuninstall={() => void uninstall(id, row)}
            onoption={(key, value) => writeOption(id, row, key, value)}
            onsecret={() => repo.plugins.key(id).refresh()}
          />
        {/each}
      </div>
    </Group>

    <Group title="Marketplaces">
      <Marketplaces {marketplaces} />
    </Group>
  {/if}
</div>
