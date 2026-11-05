<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { PluginOptionValues } from '@tagma/server/plugins/contract/wire/settings';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Layers from '@lucide/svelte/icons/layers';
  import Power from '@lucide/svelte/icons/power';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { SecretsRepo } from '$lib/features/secrets/Repo.js';
  import SecretFields from '$lib/features/secrets/SecretFields.svelte';
  import type { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import Gives from '$lib/features/plugins/Gives.svelte';
  import type { Here } from '$lib/features/plugins/here.js';
  import OptionField from '$lib/features/plugins/OptionField.svelte';
  import { optionsWith } from '$lib/features/plugins/options.js';
  import ProcessStep from '$lib/features/plugins/ProcessStep.svelte';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import ServerSteps from '$lib/features/plugins/ServerSteps.svelte';
  import Tile from '$lib/features/plugins/Tile.svelte';
  import TryIt from '$lib/features/plugins/TryIt.svelte';
  import { FORMATS } from '$lib/features/plugins/words.js';

  let {
    item,
    project,
    catalog,
    onchanged,
    onremoved,
  }: {
    item: Extract<Here, { kind: 'plugin' }>;
    project: Project;
    catalog: SettingsCatalog | null;
    onchanged: () => Promise<unknown>;
    onremoved: () => void;
  } = $props();

  const OPTIONS = 'plugins.options';
  const SECRET_OWNER = 'plugins';

  const repo = PluginsRepo.use();
  const secrets = SecretsRepo.use();

  const row = $derived(item.row);
  const owned = $derived(secrets.sets.key({ projectId: project.id, owner: SECRET_OWNER }));
  const secretSet = $derived(owned.data?.find((set) => set.id === row.id));
  const optionsEntry = $derived(catalog?.entriesOf('plugins').find((entry) => entry.id === OPTIONS));
  const values = $derived(
    (optionsEntry === undefined || catalog === null
      ? undefined
      : (catalog.answerOf(optionsEntry, 'user').own as PluginOptionValues | undefined)) ?? {},
  );
  const plain = $derived(row.options.filter((option) => !option.sensitive));
  const skill = $derived(row.components.find((component) => component.kind === 'skill')?.name ?? null);

  let busy = $state<string | null>(null);
  let failed = $state<Told | undefined>(undefined);

  async function act(doing: string, work: () => Promise<unknown>): Promise<void> {
    busy = doing;
    failed = undefined;
    try {
      await work();
      await onchanged();
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      busy = null;
    }
  }

  const enable = (enabled: boolean, scope: SettableScope) =>
    act('enable', () => repo.enable.run({ projectId: project.id, id: row.id, enabled, scope }, { throwOnError: true }));
  const update = () => act('update', () => repo.update.run({ projectId: project.id, id: row.id }, { throwOnError: true }));
  const remove = () =>
    act('remove', async () => {
      await repo.uninstall.run({ projectId: project.id, id: row.id }, { throwOnError: true });
      onremoved();
    });

  async function writeOption(key: string, value: string): Promise<boolean> {
    if (catalog === null) return false;
    busy = 'option';
    try {
      await catalog.write({ scope: 'user', key: OPTIONS, value: optionsWith(values, row.id, key, value) });
      if (catalog.outcomes[OPTIONS]?.kind !== 'saved') return false;
      await onchanged();
      return true;
    } finally {
      busy = null;
    }
  }

  const where = $derived(
    row.everywhere
      ? row.enabled
        ? 'Runs in all your projects'
        : `Off in ${project.name}, on in your other projects`
      : row.enabled
        ? `Runs in ${project.name}`
        : `Off in ${project.name}`,
  );
</script>

<div class="mx-auto grid w-full max-w-5xl grid-cols-[1fr_15rem] content-start gap-10 px-8 py-6">
  <div class="grid min-w-0 content-start gap-6">
    <header class="grid grid-cols-[auto_1fr_auto] items-center gap-4">
      <Tile title={item.title} size="lg" />
      <div class="grid min-w-0 gap-0.5">
        <FadeText text={item.title} class="text-title font-semibold" />
        <span class="text-small text-muted-foreground">{where}</span>
      </div>
      <div class="flex items-center gap-2">
        {#if !row.enabled}
          <Button disabled={busy !== null} onclick={() => void enable(true, 'project')}>Turn on in {project.name}</Button>
        {:else if item.newer !== null}
          <Button disabled={busy !== null} onclick={() => void update()}
            >{busy === 'update' ? 'Updating…' : `Update to ${item.newer}`}</Button
          >
        {:else if item.state === 'ok'}
          <TryIt title={item.title} {skill} />
        {/if}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            aria-label="More about {item.title}"
          >
            <Ellipsis class="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="min-w-60">
            {#if row.enabled}
              <DropdownMenu.Item icon={Power} disabled={busy !== null} onSelect={() => void enable(false, 'project')}>
                Turn off in {project.name}
              </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Item icon={Layers} disabled={busy !== null} onSelect={() => void enable(!row.everywhere, 'user')}>
              {row.everywhere ? 'Stop running in all projects' : 'Run in all my projects'}
            </DropdownMenu.Item>
            {#if item.newer !== null}
              <DropdownMenu.Item icon={RefreshCw} disabled={busy !== null} onSelect={() => void update()}
                >Update to {item.newer}</DropdownMenu.Item
              >
            {/if}
            <DropdownMenu.Separator />
            <DropdownMenu.Item icon={Trash2} variant="destructive" disabled={busy !== null} onSelect={() => void remove()}>
              Remove from this machine
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>

    {#if row.description !== null && row.description !== ''}<p class="max-w-prose text-body">{row.description}</p>{/if}

    {#if row.refused !== undefined}
      <Callout
        tone="error"
        title={row.process?.state === 'running'
          ? 'Tagma cannot read the plugin’s files as they are now; the version that was working keeps running'
          : 'Tagma cannot read this plugin, so agents get nothing from it'}
        note={row.refused}
      />
    {/if}
    {#if failed !== undefined}<Callout tone="error" title={failed.text} note={failed.note} />{/if}

    {#if row.process !== undefined || (row.enabled && item.servers.length > 0)}
      <section class="grid rounded-lg border bg-raised px-4 py-1" aria-label="Its services">
        {#if row.process !== undefined}<ProcessStep process={row.process} here={row.enabled} />{/if}
        {#if row.enabled}<ServerSteps projectId={project.id} servers={item.servers} />{/if}
      </section>
    {/if}

    {#if plain.length > 0 || row.options.some((option) => option.sensitive)}
      <section class="grid gap-2" aria-label="Options">
        <h3 class="text-small font-medium text-muted-foreground">Options</h3>
        <div class="grid overflow-hidden rounded-lg border bg-raised">
          {#each plain as option (option.key)}
            <OptionField
              {option}
              value={values[row.id]?.[option.key] ?? ''}
              busy={busy !== null}
              onwrite={(value) => writeOption(option.key, value)}
            />
          {/each}
          {#if secretSet !== undefined}
            <SecretFields set={secretSet} projectId={project.id} {onchanged} />
          {:else if !row.enabled && row.options.some((option) => option.sensitive)}
            <p class="border-t px-3 py-3 text-small text-muted-foreground">
              Its secret values are entered here once it runs in {project.name}.
            </p>
          {/if}
        </div>
      </section>
    {/if}

    <Gives components={row.components} ignored={row.ignored} options={[]} />
  </div>

  <aside class="grid content-start gap-3 pt-2 text-small">
    {#if row.version !== null}
      <div class="grid gap-0.5"><span class="text-meta text-muted-foreground">Version</span><span class="tabular">{row.version}</span></div>
    {/if}
    {#if row.origin !== undefined}
      <div class="grid gap-0.5"><span class="text-meta text-muted-foreground">From</span><FadeText text={row.origin.marketplace} /></div>
    {/if}
    {#if row.format !== null}
      <div class="grid gap-0.5">
        <span class="text-meta text-muted-foreground">Package</span><span>{FORMATS[row.format] ?? row.format} format</span>
      </div>
    {/if}
    <div class="grid gap-0.5">
      <span class="text-meta text-muted-foreground">Read from</span>
      {#if row.source.kind === 'folder'}<PathText path={row.source.path} class="stamp" />{:else}<FadeText
          text={row.source.url}
          class="stamp"
        />{/if}
    </div>
  </aside>
</div>
