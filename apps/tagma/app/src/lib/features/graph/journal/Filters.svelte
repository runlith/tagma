<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import type { SvelteSet } from 'svelte/reactivity';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { opWord } from '$lib/features/graph/journal/actions.js';
  import { authorName } from '$lib/features/graph/journal/authors.js';
  import type { JournalScreen } from '$lib/features/graph/journal/Screen.svelte.js';
  import { rank } from '@runlith/search-text/match';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import * as Command from '$lib/shared/ui/command/index.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';

  let { journal }: { journal: JournalScreen } = $props();

  const tags = TagCatalog.use();
  const naming = SessionNaming.use();

  const sessions = $derived(new Map(journal.vocabulary.sessions.map((row) => [String(row.id), row])));
  const sessionOf = (value: string) => sessions.get(value);
  const authorOf = (value: string): string => {
    const named = sessionOf(value);
    return named === undefined ? value : authorName(named, naming.identity);
  };

  const soleTag = $derived(journal.selectedTags.size === 1 ? tags.label([...journal.selectedTags][0] ?? '') : undefined);
  const soleSession = $derived(journal.selectedSessions.size === 1 ? authorOf([...journal.selectedSessions][0] ?? '') : undefined);
  const soleOp = $derived(journal.selectedOps.size === 1 ? opWord([...journal.selectedOps][0] ?? '') : undefined);

  const queries = $state<Record<string, string>>({ Types: '', Threads: '', Actions: '' });

  const control = (active: boolean) =>
    cn(
      'flex h-7 items-center gap-1.5 rounded-md border px-2 text-ui transition-colors duration-150 ease-instrument data-[state=open]:bg-selected',
      active ? 'border-brand/50 bg-selected text-foreground' : 'border-input text-muted-foreground hover:bg-hover hover:text-foreground',
    );
</script>

{#snippet picker(
  what: string,
  values: readonly string[],
  selected: SvelteSet<string>,
  sole: string | undefined,
  row: Snippet<[string, readonly number[]]>,
  label: (value: string) => string,
  keywords: (value: string) => readonly string[],
)}
  <Popover.Root
    onOpenChange={(open) => {
      if (open) queries[what] = '';
    }}
  >
    <Popover.Trigger class={control(selected.size > 0)}>
      {#if sole}
        {sole}
      {:else if selected.size > 0}
        {selected.size} {what.toLowerCase()}
      {:else}
        {what}
      {/if}
      <ChevronDown class="size-3 opacity-60" />
    </Popover.Trigger>
    <Popover.Content align="end" class="w-72 gap-0 p-0">
      <Command.Root>
        <Command.Input bind:value={queries[what]} placeholder={`Search ${what.toLowerCase()}…`} />
        <Command.List>
          {@const shown = rank(values, queries[what] ?? '', (value) => ({ name: label(value), text: keywords(value) }))}
          {#if shown.length === 0}
            <Command.Empty>Nothing matches.</Command.Empty>
          {/if}
          {#each shown as { item: value, hit } (value)}
            <Command.Item
              {value}
              data-checked={selected.has(value)}
              onSelect={() => (selected.has(value) ? selected.delete(value) : selected.add(value))}
            >
              {@render row(value, hit.positions)}
            </Command.Item>
          {/each}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
{/snippet}

{#snippet tagRow(value: string, positions: readonly number[])}
  <TagIcon tag={value} class="size-3.5 shrink-0 text-muted-foreground" />
  <FadeText class="flex-1"><MatchText text={tags.label(value)} {positions} /></FadeText>
{/snippet}

{#snippet sessionRow(value: string, positions: readonly number[])}
  <FadeText class="flex-1"><MatchText text={authorOf(value)} {positions} /></FadeText>
  <span class="shrink-0 text-muted-foreground">{sessionOf(value)?.harness ?? ''}</span>
{/snippet}

{#snippet opRow(value: string, positions: readonly number[])}
  <FadeText class="flex-1"><MatchText text={opWord(value)} {positions} /></FadeText>
  <span class="stamp shrink-0 text-muted-foreground">{value}</span>
{/snippet}

{#if journal.vocabulary.tags.length > 1}
  {@render picker(
    'Types',
    journal.vocabulary.tags,
    journal.selectedTags,
    soleTag,
    tagRow,
    (value) => tags.label(value),
    (value) => [value],
  )}
{/if}
{#if journal.vocabulary.sessions.length > 1 || journal.selectedSessions.size > 0}
  {@render picker(
    'Threads',
    journal.vocabulary.sessions.map((row) => String(row.id)),
    journal.selectedSessions,
    soleSession,
    sessionRow,
    authorOf,
    (value) => [sessionOf(value)?.harness ?? ''],
  )}
{/if}
{#if journal.vocabulary.ops.length > 1}
  {@render picker('Actions', journal.vocabulary.ops, journal.selectedOps, soleOp, opRow, opWord, (value) => [value])}
{/if}
<button
  type="button"
  class={cn(control(false), 'disabled:pointer-events-none disabled:opacity-50')}
  disabled={!journal.filtered}
  onclick={() => journal.clearFilter()}
>
  <X class="size-3" />
  Reset
</button>
