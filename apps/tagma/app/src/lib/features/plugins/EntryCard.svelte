<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { EntryRow, MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import type { PluginPreview } from '@tagma/server/plugins/contract/wire/rows';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { scopeName } from '$lib/features/settings/scope.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import Components from '$lib/features/plugins/Components.svelte';
  import SignIns from '$lib/features/plugins/SignIns.svelte';
  import { FORMATS, KINDS, LABELS, originOf } from '$lib/features/plugins/words.js';

  let {
    entry,
    marketplace,
    project,
    scope,
    oninstalled,
  }: {
    entry: EntryRow;
    marketplace: MarketplaceRow | undefined;
    project: Project;
    scope: SettableScope;
    oninstalled: () => Promise<unknown>;
  } = $props();

  const repo = PluginsRepo.use();

  let open = $state(false);
  let preparing = $state(false);
  let installing = $state(false);
  let preview = $state<PluginPreview | undefined>(undefined);
  let failed = $state<Told | undefined>(undefined);
  let installed = $state<string | null>(null);

  const title = $derived(entry.title ?? entry.name);
  const said = $derived(
    entry.state === 'installed'
      ? 'Installed'
      : entry.state === 'taken'
        ? `Installed from ${entry.taken ?? 'another source'}`
        : entry.state === 'refused'
          ? 'Tagma does not install it'
          : null,
  );
  const about = $derived([
    { label: 'Author', value: preview?.about.author ?? entry.author },
    { label: 'Repository', value: preview?.about.repository ?? entry.repository },
    { label: 'Homepage', value: preview?.about.homepage ?? entry.homepage },
    { label: 'License', value: preview?.about.license ?? null },
    { label: 'Version', value: preview?.version ?? entry.version },
    { label: 'Format', value: preview === undefined ? null : (FORMATS[preview.format] ?? preview.format) },
  ]);
  const consent = $derived(
    preview === undefined
      ? []
      : [
          { label: 'Runs as you', items: preview.consent.runs },
          { label: 'Reaches', items: preview.consent.reaches },
          { label: 'Also asks about', items: preview.consent.raises },
        ].filter((group) => group.items.length > 0),
  );

  async function prepare(): Promise<void> {
    preparing = true;
    failed = undefined;
    try {
      preview = await repo.preview.run(
        { projectId: project.id, marketplace: entry.marketplace, entry: entry.name },
        { throwOnError: true },
      );
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      preparing = false;
    }
  }

  function toggle(): void {
    open = !open;
    if (!open || entry.state === 'refused' || preparing) return;
    if (preview === undefined || Date.parse(preview.expires) <= Date.now()) void prepare();
  }

  async function install(prepared: string): Promise<void> {
    installing = true;
    failed = undefined;
    try {
      const plugin = await repo.installPrepared.run({ projectId: project.id, prepared, scope }, { throwOnError: true });
      preview = undefined;
      installed = plugin?.id ?? null;
      await oninstalled();
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      installing = false;
    }
  }
</script>

<section class="overflow-hidden rounded-lg border bg-raised" aria-label={title} data-entry="{entry.marketplace}/{entry.name}">
  <button
    type="button"
    class="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left transition-colors select-none hover:bg-hover"
    aria-expanded={open}
    onclick={toggle}
  >
    <ChevronRight class={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
    <span class="grid min-w-0 flex-1 gap-1">
      <span class="flex min-w-0 items-baseline gap-2">
        <FadeText text={title} class="text-ui font-semibold" />
        {#if entry.version !== null}<span class="shrink-0 text-small text-muted-foreground tabular">{entry.version}</span>{/if}
        <span class="flex-1"></span>
        {#if said !== null}<FadeText text={said} class="max-w-1/2 text-small text-muted-foreground" />{/if}
      </span>
      {#if entry.description !== null && entry.description !== ''}
        <FadeText text={entry.description} class="text-small text-muted-foreground" />
      {/if}
      <span class="flex flex-wrap items-center gap-1">
        {#each entry.brings as kind (kind)}
          <span class="eyebrow rounded-md border border-vein px-1.5 py-0.5 text-muted-foreground">{KINDS[kind]}</span>
        {/each}
        <span class="flex-1"></span>
        {#if marketplace !== undefined}
          <span class="text-small text-muted-foreground">{originOf(marketplace)}</span>
          <span class="eyebrow rounded-md bg-selected px-1.5 py-0.5 text-muted-foreground">{LABELS[marketplace.label]}</span>
        {/if}
      </span>
    </span>
  </button>

  {#if open}
    {#if entry.state === 'refused'}
      <div class="border-t border-border px-3 py-3">
        <Callout tone="error" title="Tagma does not install this entry" note={entry.reason} />
      </div>
    {:else}
      <div class="grid gap-1 border-t border-border bg-sunken/40 px-3 py-2">
        {#each about as fact (fact.label)}
          {#if fact.value !== null && fact.value !== ''}
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="w-24 shrink-0 text-small text-muted-foreground">{fact.label}</span>
              <FadeText text={fact.value} class="text-small" />
            </div>
          {/if}
        {/each}
        {#if entry.policy !== null}
          <div class="flex min-w-0 items-baseline gap-2">
            <span class="w-24 shrink-0 text-small text-muted-foreground">Codex policy</span>
            <FadeText
              text={[entry.policy.installation, entry.policy.authentication, ...entry.policy.products]
                .filter((part) => part !== null)
                .join(', ')}
              class="text-small"
            />
          </div>
        {/if}
      </div>

      {#if preparing}
        <div class="flex items-center gap-2 border-t border-border px-3 py-3">
          <Waiting class="size-3" />
          <span class="text-ui text-muted-foreground">Fetching the plugin to read what it brings</span>
        </div>
      {/if}

      {#if preview !== undefined}
        <Components components={preview.components} ignored={preview.ignored} />
        {#if consent.length > 0}
          <div class="grid gap-2 border-t border-border px-3 py-3">
            <p class="text-small text-muted-foreground">Installing asks your consent for</p>
            {#each consent as group (group.label)}
              <div class="grid gap-0.5">
                <p class="text-ui font-medium">{group.label}</p>
                {#each group.items as item, index (index)}
                  <FadeText text={item} class="stamp" />
                {/each}
              </div>
            {/each}
          </div>
        {/if}
        <div class="flex items-center gap-2 border-t border-border px-3 py-2">
          <span class="flex-1 text-small text-muted-foreground">Runs in {scopeName(scope, project)}</span>
          <Button size="sm" disabled={installing} onclick={() => preview !== undefined && void install(preview.prepared)}>
            {installing ? 'Installing…' : preview.replaces ? 'Install this version' : 'Install'}
          </Button>
        </div>
      {/if}

      {#if failed !== undefined}
        <div class="border-t border-border px-3 py-3">
          <Callout tone="error" title={failed.text} note={failed.note} />
        </div>
      {/if}

      {#if installed !== null}
        <p class="border-t border-border px-3 py-2 text-small text-muted-foreground">Installed; it runs in {scopeName(scope, project)}.</p>
        <SignIns projectId={project.id} plugin={installed} />
      {/if}
    {/if}
  {/if}
</section>
