<script lang="ts">
  import type { SettingChoiceSet } from '@tagma/server/platform/contract/wire/setting';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { catalogEntries, catalogGroups, ModelChoices } from '$lib/features/settings/controls/catalogs.js';
  import { rank } from '@runlith/search-text/match';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';

  const FILTER_FROM = 8;

  let {
    label,
    of,
    value,
    fallback,
    disabled = false,
    chip = false,
    blank,
    onwrite,
  }: {
    label: string;
    of: SettingChoiceSet;
    value: unknown;
    fallback?: unknown;
    disabled?: boolean;
    chip?: boolean;
    blank?: string;
    onwrite: (value: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');

  const choices = ModelChoices.use();
  const entries = $derived(catalogEntries(of, choices).filter((entry) => !chip || entry.value !== ''));
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

{#snippet swatches(colours: readonly string[])}
  <span class="flex shrink-0 overflow-hidden rounded-sm border border-vein">
    {#each colours as colour, index (index)}
      <span class="h-3.5 w-1.5" style="background-color: {colour}"></span>
    {/each}
  </span>
{/snippet}

<div class={chip ? 'flex min-w-0' : 'grid w-full min-w-0 gap-1.5 @xl/settings:w-72'}>
  <Popover.Root
    bind:open
    onOpenChange={(next) => {
      if (next) query = '';
    }}
  >
    <Popover.Trigger
      class={chip
        ? 'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-small font-medium transition-colors hover:bg-hover disabled:opacity-50 data-[state=open]:bg-selected'
        : 'flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-small transition-colors hover:bg-hover disabled:opacity-50'}
      aria-label={label}
      {disabled}
    >
      {#if chosen}
        {@render swatches(chosen.swatches)}
      {/if}
      <FadeText
        class={['min-w-0 flex-1 text-left', chosen === undefined && blank !== undefined && 'text-muted-foreground']}
        text={chosen?.label ?? (current === '' && blank !== undefined ? blank : current)}
      />
      <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
    </Popover.Trigger>
    <Popover.Content align={chip ? 'start' : 'end'} class="w-72 p-0">
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
                  {@render swatches(entry.swatches)}
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
