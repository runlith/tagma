<script lang="ts">
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import Search from '@lucide/svelte/icons/search';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { Host } from '@runlith/layer/Host';
  import { untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { standFound } from '$lib/features/settings/found.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import Column from '$lib/features/settings/Column.svelte';
  import { columnGroups, type ColumnSection } from '$lib/features/settings/column.js';
  import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';
  import Head from '$lib/features/settings/Head.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { match, terms } from '@runlith/search-text/match';
  import { settingTarget } from '$lib/features/settings/match.js';
  import { SettingsParts, standParts } from '$lib/features/settings/parts.svelte.js';
  import { sectionScope, sectionScopes } from '$lib/features/settings/scope.js';
  import ScopeSwitch from '$lib/features/settings/ScopeSwitch.svelte';
  import SearchResults from '$lib/features/settings/SearchResults.svelte';
  import type { SectionPlace } from '$lib/features/settings/section.js';
  import type { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';

  let {
    catalog,
    active,
    scope,
    column,
    oncollapse,
    onvisit,
  }: {
    catalog: SettingsCatalog;
    active: string;
    scope: SettableScope;
    column: boolean;
    oncollapse: () => void;
    onvisit: (section: string, scope: SettableScope) => void;
  } = $props();

  const workspace = Workspace.use();
  const project = $derived(workspace.find(catalog.projectId));
  const host = Host.use();
  const router = Router.use();
  const registry = SectionRegistry.use();

  const parts = new SettingsParts();
  standParts(parts);

  type Known = { readonly id: string; readonly title: string; readonly description: string; readonly place: SectionPlace | null };

  const LOCAL_SECTIONS: readonly Known[] = registry.sections.flatMap((section) =>
    section.local === undefined || (section.hosts !== undefined && !section.hosts.includes(host.kind))
      ? []
      : [{ id: section.id, ...section.local, place: section.place ?? null }],
  );

  let query = $state('');
  let field = $state<HTMLInputElement | null>(null);
  let pane = $state<HTMLElement | null>(null);
  const searching = $derived(terms(query).length > 0);

  const FOUND_SHOWN_MS = 2_500;
  const wanted = $derived(router.url.searchParams.get('key'));
  let found = $state<string | null>(null);
  standFound(() => found);

  const catalogRead = $derived(catalog.entries.length > 0);

  $effect(() => {
    const key = wanted;
    const scroller = pane;
    if (key === null || scroller === null || !catalogRead) return;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const land = (): boolean => {
      const row = scroller.querySelector(`[data-setting~="${CSS.escape(key)}"]`);
      if (row === null) return false;
      row.scrollIntoView({ block: 'center' });
      found = key;
      fade = setTimeout(() => (found = null), FOUND_SHOWN_MS);
      return true;
    };
    if (land()) return () => clearTimeout(fade);
    const awaiting = new MutationObserver(() => {
      if (land()) awaiting.disconnect();
    });
    awaiting.observe(scroller, { childList: true, subtree: true });
    return () => {
      awaiting.disconnect();
      clearTimeout(fade);
    };
  });

  const known = $derived<readonly Known[]>([
    ...catalog.sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      place: registry.find(section.id)?.place ?? null,
    })),
    ...LOCAL_SECTIONS,
  ]);

  function scopeOf(sectionId: string): SettableScope {
    return sectionScope(catalog.entriesOf(sectionId), scope);
  }

  const hits = $derived.by(() => {
    if (!searching) return null;
    const counted = new Map<string, number>();
    for (const section of catalog.sections) {
      counted.set(section.id, catalog.entriesOf(section.id).filter((entry) => match(query, settingTarget(entry)) !== null).length);
    }
    return counted;
  });
  const hitCount = $derived(hits === null ? 0 : [...hits.values()].reduce((sum, count) => sum + count, 0));

  function shown(section: Known): ColumnSection | null {
    const matched = hits?.get(section.id) ?? 0;
    if (hits !== null && matched === 0 && match(query, { name: section.title }) === null) return null;
    return {
      id: section.id,
      title: section.title,
      icon: registry.find(section.id)?.icon ?? SlidersHorizontal,
      count: hits !== null ? matched : catalog.setCount(scopeOf(section.id), section.id),
    };
  }

  const groups = $derived(columnGroups(registry, known, shown));

  const settled = $derived(catalog.sections.length > 0 || (!catalog.loading && catalog.error === null));
  const activeSection = $derived(known.find((section) => section.id === active) ?? (settled ? known[0] : undefined));
  const activeId = $derived(activeSection?.id ?? null);
  const declared = $derived(activeId === null ? undefined : registry.find(activeId));
  const View = $derived(declared?.view);
  const Icon = $derived(declared?.icon ?? SlidersHorizontal);
  const effective = $derived(activeId === null ? scope : scopeOf(activeId));
  const accepted = $derived(activeId === null ? [] : sectionScopes(catalog.entriesOf(activeId)));
  const reading = $derived(catalog.loading && catalog.entries.length === 0);
  const unread = $derived(catalog.error !== null && catalog.entries.length === 0);

  $effect(() => {
    const id = activeId;
    const at = scope;
    if (id !== null) untrack(() => onvisit(id, at));
  });

  $effect(() => {
    const scroller = pane;
    if (scroller !== null) return parts.watch(scroller);
  });

  $effect(() => {
    void parts.list;
    untrack(() => parts.schedule());
  });

  $effect(() => {
    void activeId;
    void searching;
    untrack(() => {
      if (pane !== null && wanted === null) pane.scrollTop = 0;
    });
  });

  const crumb = $derived(
    searching ? `${hitCount} key${hitCount === 1 ? '' : 's'}` : parts.list.length > 1 ? (parts.list[parts.current]?.title ?? null) : null,
  );

  function pick(): void {
    query = '';
  }

  function windowKeys(event: KeyboardEvent): void {
    if (event.key !== '/' || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target !== document.body && target.closest('[data-settings-column]') === null) return;
    if (target.closest('input, textarea, select, [contenteditable], [role="textbox"]') !== null) return;
    event.preventDefault();
    field?.focus();
  }

  function fieldKeys(event: KeyboardEvent): void {
    if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      query = '';
    } else if (event.key === 'Enter' && searching) {
      event.preventDefault();
      pane?.querySelector<HTMLElement>('[data-setting] :is(button, input, select, a[href], [tabindex="0"]):not(:disabled)')?.focus();
    }
  }
</script>

<svelte:window onkeydown={windowKeys} />

{#snippet filter()}
  <label class="flex h-7 items-center gap-1.5 rounded-md bg-sunken px-2 text-muted-foreground focus-within:text-foreground">
    <Search class="size-3.5 shrink-0" />
    <input
      bind:this={field}
      bind:value={query}
      type="text"
      placeholder="Filter"
      aria-label="Filter settings"
      class="min-w-0 flex-1 bg-transparent text-small text-foreground outline-none placeholder:text-muted-foreground"
      onkeydown={fieldKeys}
    />
    <Kbd chord="/" size="sm" />
  </label>
{/snippet}

{#snippet layer()}
  {#if activeSection}
    <ScopeSwitch section={activeSection.id} scope={effective} scopes={accepted} place={activeSection.place} {project} />
  {/if}
{/snippet}

<div class="flex h-full min-h-0">
  {#if column}
    <Column {groups} active={activeId} {scope} {parts} {searching} {filter} onpick={pick} onCollapse={oncollapse} />
  {/if}

  <div bind:this={pane} class="@container/settings min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
    <Head
      icon={searching || activeSection === undefined ? null : Icon}
      title={searching ? 'Search' : (activeSection?.title ?? 'Settings')}
      {crumb}
      picker={column || groups.length === 0 ? null : groups}
      current={searching ? null : activeId}
      {scope}
      onpick={pick}
      filter={column ? undefined : filter}
      layer={searching || activeSection === undefined ? undefined : layer}
    />

    <div class="page-reading pb-16">
      {#if searching}
        <div class="pt-2">
          <SearchResults {query} {catalog} {scopeOf} {project} />
        </div>
      {:else}
        {#if activeSection?.description}
          <p class="pt-4 text-body text-muted-foreground">{activeSection.description}</p>
        {/if}

        {#if declared?.standalone && View}
          <div class="pt-4"><View {catalog} scope={effective} {project} /></div>
        {:else if unread}
          <div class="mt-6 grid gap-2 rounded-lg border border-destructive/40 bg-raised px-3 py-3">
            <p class="text-ui text-destructive">The settings catalog could not be read: {catalog.error}</p>
            <div>
              <Button variant="outline" size="sm" onclick={() => void catalog.load()}>Retry</Button>
            </div>
          </div>
        {:else if reading}
          <div class="mt-6 grid" aria-hidden="true">
            {#each [0, 1, 2, 3] as row (row)}
              <div class="flex items-center gap-4 py-3" class:border-t={row > 0}>
                <div class="grid min-w-0 flex-1 gap-2">
                  <div class="h-3 w-40 animate-pulse rounded-sm bg-vein-strong/40"></div>
                  <div class="h-2.5 w-64 animate-pulse rounded-sm bg-vein/80"></div>
                </div>
                <div class="h-5 w-24 shrink-0 animate-pulse rounded-sm bg-vein-strong/40"></div>
              </div>
            {/each}
          </div>
        {:else if View}
          <View {catalog} scope={effective} {project} />
        {:else if activeId !== null}
          <KeyCard entries={catalog.entriesOf(activeId)} {catalog} scope={effective} {project} />
        {/if}
      {/if}
    </div>
  </div>
</div>
