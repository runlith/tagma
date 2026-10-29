<script lang="ts">
  import type { PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import type { PluginOptionValues } from '@tagma/server/plugins/contract/wire/settings';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import PluginCard from '$lib/features/plugins/PluginCard.svelte';
  import { optionsWith } from '$lib/features/plugins/options.js';

  let { catalog, project }: SectionProps = $props();

  const OPTIONS = 'plugins.options';
  const SECRET_OWNER = 'plugins';

  const repo = PluginsRepo.use();
  const secrets = SecretsRepo.use();
  const notices = Notices.use();

  const projectId = $derived(project?.id);
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
      await repo.install.run({ projectId: id, source: from }, { throwOnError: true });
      source = '';
    });
  }

  const setEnabled = (id: number, row: PluginRow, enabled: boolean) =>
    act(id, row.id, () => repo.enable.run({ projectId: id, id: row.id, enabled }, { throwOnError: true }));

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
  {:else}
    {@const id = projectId}
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

        {#if listed?.error}
          <p class="text-ui text-destructive">
            The plugins could not be read: {listed.error instanceof Error ? listed.error.message : String(listed.error)}
          </p>
        {:else if listed?.isPending && rows.length === 0}
          <p class="text-ui text-muted-foreground">Reading the plugins…</p>
        {:else if rows.length === 0}
          <p class="text-ui text-muted-foreground">
            No plugin is installed yet. Tagma reads Claude Code plugins and Agent Plugins packages from a folder, in place, or from a git
            URL it clones.
          </p>
        {/if}

        {#each rows as row (row.id)}
          <PluginCard
            {row}
            projectId={id}
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
  {/if}
</div>
