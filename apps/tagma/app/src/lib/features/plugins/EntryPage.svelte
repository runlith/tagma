<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
  import type { PluginPreview, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { untrack } from 'svelte';
  import Layers from '@lucide/svelte/icons/layers';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { type Listing, titleOf } from '$lib/features/plugins/catalog.js';
  import Gives from '$lib/features/plugins/Gives.svelte';
  import { idOf } from '$lib/features/plugins/place.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import ServerSteps from '$lib/features/plugins/ServerSteps.svelte';
  import Tile from '$lib/features/plugins/Tile.svelte';
  import TryIt from '$lib/features/plugins/TryIt.svelte';
  import { FORMATS, originOf } from '$lib/features/plugins/words.js';

  let {
    listing,
    project,
    plugins,
    servers,
    hrefOf,
    onadded,
  }: {
    listing: Listing;
    project: Project;
    plugins: readonly PluginRow[];
    servers: readonly McpServerRow[];
    hrefOf: (id: string | null) => string;
    onadded: () => Promise<unknown>;
  } = $props();

  const repo = PluginsRepo.use();

  const entry = $derived(listing.entry);
  const key = $derived(`${entry.marketplace}/${entry.name}`);
  const title = $derived(titleOf(entry));

  let preview = $state<PluginPreview | undefined>(undefined);
  let preparing = $state(false);
  let adding = $state<SettableScope | null>(null);
  let added = $state<string | null>(null);
  let failed = $state<Told | undefined>(undefined);

  const installed = $derived(plugins.find((row) => row.origin?.marketplace === entry.marketplace && row.origin.entry === entry.name));
  const pluginId = $derived(added ?? installed?.id ?? null);
  const own = $derived(pluginId === null ? [] : servers.filter((row) => row.scope === 'contributed' && row.contributor === pluginId));
  const ready = $derived(added !== null && own.every((row) => row.status === 'connected'));

  async function prepare(at: string): Promise<void> {
    preview = undefined;
    added = null;
    failed = undefined;
    if (entry.state === 'refused') return;
    preparing = true;
    try {
      const prepared = await repo.preview.run(
        { projectId: project.id, marketplace: entry.marketplace, entry: entry.name },
        { throwOnError: true },
      );
      if (at === key) preview = prepared;
    } catch (error: unknown) {
      if (at === key) failed = toldOf(error);
    } finally {
      if (at === key) preparing = false;
    }
  }

  $effect(() => {
    const at = key;
    untrack(() => void prepare(at));
  });

  async function add(scope: SettableScope): Promise<void> {
    const prepared = preview?.prepared;
    if (prepared === undefined) return;
    adding = scope;
    failed = undefined;
    try {
      const plugin = await repo.installPrepared.run({ projectId: project.id, prepared, scope }, { throwOnError: true });
      added = plugin?.id ?? null;
      await onadded();
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      adding = null;
    }
  }

  const facts = $derived(
    [
      { label: 'Version', value: preview?.version ?? entry.version },
      { label: 'Made by', value: preview?.about.author ?? entry.author },
      { label: 'Repository', value: preview?.about.repository ?? entry.repository },
      { label: 'License', value: preview?.about.license ?? null },
      { label: 'Category', value: entry.category },
      { label: 'Package', value: preview === undefined ? null : `${FORMATS[preview.format] ?? preview.format} format` },
    ].filter((fact): fact is { label: string; value: string } => fact.value !== null && fact.value !== ''),
  );
  const also = $derived(listing.also.map((one) => one.marketplace));
</script>

<div class="mx-auto grid w-full max-w-5xl grid-cols-[1fr_15rem] content-start gap-10 px-8 py-6">
  <div class="grid min-w-0 content-start gap-6">
    <header class="grid grid-cols-[auto_1fr_auto] items-center gap-4">
      <Tile {title} size="lg" />
      <div class="grid min-w-0 gap-0.5">
        <FadeText text={title} class="text-title font-semibold" />
        <span class="flex min-w-0 items-center gap-2 text-small text-muted-foreground">
          {#if listing.marketplace !== undefined}<span>{originOf(listing.marketplace)}</span>{/if}
          {#if listing.marketplace?.label === 'unreviewed'}<span class="rounded-sm border px-1.5 text-meta">Unreviewed</span>{/if}
          {#if also.length > 0}<FadeText text="Also offered by {also.join(', ')}" class="text-muted-foreground/70" />{/if}
        </span>
      </div>
      {#if installed !== undefined}
        <Button href={hrefOf(idOf({ kind: 'plugin', id: installed.id }))} variant="outline">Open in {project.name}</Button>
      {:else if entry.state === 'taken'}
        <span class="text-small text-muted-foreground">Installed from {entry.taken ?? 'another source'}</span>
      {:else if entry.state !== 'refused' && added === null}
        <div class="flex">
          <Button class="rounded-r-none" disabled={preview === undefined || adding !== null} onclick={() => void add('project')}>
            {adding === 'project' ? 'Adding…' : `Add to ${project.name}`}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={cn(buttonVariants(), 'rounded-l-none border-l-primary-foreground/20 px-2')}
              disabled={preview === undefined || adding !== null}
              aria-label="More ways to add"
            >
              <ChevronDown class="size-3.5" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="min-w-56">
              <DropdownMenu.Item icon={Layers} onSelect={() => void add('user')}>Add to all my projects</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {/if}
    </header>

    {#if entry.description !== null || preview?.description}
      <p class="max-w-prose text-body">{preview?.description ?? entry.description}</p>
    {/if}

    {#if entry.state === 'refused'}
      <Callout tone="error" title="Tagma does not install this plugin" note={entry.reason} />
    {/if}
    {#if failed !== undefined}<Callout tone="error" title={failed.text} note={failed.note} />{/if}

    {#if pluginId !== null && (added !== null || own.some((row) => row.status !== 'connected'))}
      <section class="grid rounded-lg border bg-raised px-4 py-2" aria-label="Adding">
        {#if added !== null}
          <div class="grid grid-cols-[auto_1fr] items-start gap-3 py-2">
            <span class="grid h-5 place-items-center"><span class="size-2 bg-status-done"></span></span>
            <span class="text-ui font-medium">Added{adding === null ? '' : '…'}</span>
          </div>
        {/if}
        <ServerSteps projectId={project.id} servers={own} />
        {#if ready}
          <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2">
            <span class="grid h-5 place-items-center"><span class="size-2 bg-status-done"></span></span>
            <span class="text-ui font-medium">Ready</span>
            <TryIt {title} skill={preview?.components.find((component) => component.kind === 'skill')?.name ?? null} />
          </div>
        {/if}
      </section>
    {/if}

    {#if preparing}
      <div class="flex items-center gap-2 text-ui text-muted-foreground"><Waiting class="size-3" />Reading the plugin</div>
    {:else if preview !== undefined}
      <Gives components={preview.components} ignored={preview.ignored} consent={preview.consent} options={preview.options} />
    {/if}
  </div>

  <aside class="grid content-start gap-3 pt-2 text-small">
    {#each facts as fact (fact.label)}
      <div class="grid gap-0.5">
        <span class="text-meta text-muted-foreground">{fact.label}</span>
        <FadeText text={fact.value} />
      </div>
    {/each}
  </aside>
</div>
