<script lang="ts">
  import type { SettingChoiceSet } from '@tagma/server/platform/contract/wire/setting';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { catalogGroups, ChoiceSets } from '$lib/features/settings/controls/catalogs.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { rank } from '@runlith/search-text/match';
  import { untrack } from 'svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import Swatches from './Swatches.svelte';

  const FILTER_FROM = 8;

  let {
    label,
    of,
    value,
    fallback,
    disabled = false,
    onwrite,
  }: {
    label: string;
    of: SettingChoiceSet;
    value: unknown;
    fallback?: unknown;
    disabled?: boolean;
    onwrite: (value: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');

  const set = ChoiceSets.use().find(untrack(() => of));
  const source = set === undefined ? undefined : App.current().resolve(set.source);
  const entries = $derived(source?.entries ?? []);
  const ranked = $derived(rank(entries, query, (entry) => ({ name: entry.label, names: [entry.value] })));
  const groups = $derived(catalogGroups(ranked.map(({ item }) => item)));
  const marked = $derived(new Map(ranked.map(({ item, hit }) => [item.value, hit.positions])));
  const current = $derived(String(value ?? ''));
  const chosen = $derived(entries.find((entry) => entry.value === current));
  const shipped = $derived(fallback === undefined ? null : String(fallback));

  function pick(entry: string): void {
    open = false;
    onwrite(entry);
  }
</script>

<div class="grid w-full min-w-0 gap-1.5 @xl/settings:w-72">
  <Popover.Root
    bind:open
    onOpenChange={(next) => {
      if (next) query = '';
    }}
  >
    <Popover.Trigger
      class="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-small transition-colors hover:bg-hover disabled:opacity-50"
      aria-label={label}
      {disabled}
    >
      {#if chosen}
        <Swatches colours={chosen.swatches} />
      {/if}
      <FadeText class="min-w-0 flex-1 text-left" text={chosen?.label ?? current} />
      <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
    </Popover.Trigger>
    <Popover.Content align="end" class="w-72 p-0">
      <Command.Root>
        {#if entries.length > FILTER_FROM}
          <Command.Input bind:value={query} placeholder="Search {label.toLowerCase()}…" />
        {/if}
        <Command.List class="max-h-72">
          {#if groups.length === 0}
            <Command.Empty>Nothing matches.</Command.Empty>
          {/if}
          {#each groups as group (group.label)}
            <Command.Group heading={group.label}>
              {#each group.entries as entry (entry.value)}
                <Command.Item value={entry.value} data-checked={entry.value === current} onSelect={() => pick(entry.value)}>
                  <Swatches colours={entry.swatches} />
                  <FadeText class="flex-1 text-small"><MatchText text={entry.label} positions={marked.get(entry.value) ?? []} /></FadeText>
                  {#if entry.value === shipped}
                    <span class="eyebrow shrink-0 text-muted-foreground/70">Default</span>
                  {/if}
                </Command.Item>
              {/each}
            </Command.Group>
          {/each}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
