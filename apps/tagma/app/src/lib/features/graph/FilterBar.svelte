<script lang="ts">
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import Tags from '@lucide/svelte/icons/tags';
  import X from '@lucide/svelte/icons/x';
  import { Router } from '@runlith/layer/Router';
  import { currentDiffRange, diffLensHref } from '$lib/features/workspace/address.js';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { LENS_LABEL, lensesFor, type ReadingLens, SORT_LABEL, SORT_MODES } from '$lib/features/graph/ReadingLens.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { barTrigger, cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { lens, store, sort = true, diff = false }: { lens: ReadingLens; store?: TreeScreen; sort?: boolean; diff?: boolean } = $props();

  const tags = TagCatalog.use();
  const router = Router.use();

  const diffOn = $derived(currentDiffRange(router) !== null);
  const diffHref = $derived(diffOn ? diffLensHref(router, null) : diffLensHref(router, store?.lensReturn ?? 'read'));

  const lenses = $derived(lensesFor(tags, lens.tags));

  const soleTag = $derived(lens.tags.size === 1 ? [...lens.tags][0] : undefined);
  const soleLens = $derived(lens.states.size === 1 ? [...lens.states][0] : undefined);
  const dirty = $derived(lens.active || (sort && lens.sortMode !== 'manual'));

  const trigger = barTrigger;

  function sortBy(next: string): void {
    const mode = SORT_MODES.find((one) => one === next);
    if (mode !== undefined) lens.setSortMode(mode);
  }
</script>

<div class="flex h-7 items-center gap-0.5">
  <ListFilter class="mr-1 size-3.5 shrink-0 text-muted-foreground/50" />

  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={trigger(lens.tags.size > 0)}>
      {#if soleTag}
        <TagIcon tag={soleTag} class="size-3" />
        {tags.label(soleTag)}
      {:else if lens.tags.size > 0}
        {lens.tags.size} tags
      {:else}
        All tags
      {/if}
      <ChevronDown class="size-3 opacity-60" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="min-w-40">
      <DropdownMenu.CheckboxItem icon={Tags} bind:checked={() => lens.tags.size === 0, () => lens.clearTags()}
        >All tags</DropdownMenu.CheckboxItem
      >
      <DropdownMenu.Separator />
      {#each tags.declared as tag (tag)}
        <DropdownMenu.CheckboxItem closeOnSelect={false} bind:checked={() => lens.tags.has(tag), (on) => lens.selectTag(tag, on)}>
          {#snippet lead()}<TagIcon {tag} class="size-3.5" />{/snippet}
          {tags.label(tag)}
        </DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={trigger(lens.states.size > 0)}>
      {#if soleLens}
        {LENS_LABEL[soleLens]}
      {:else if lens.states.size > 0}
        {lens.states.size} states
      {:else}
        Any state
      {/if}
      <ChevronDown class="size-3 opacity-60" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="min-w-40">
      <DropdownMenu.CheckboxItem bind:checked={() => lens.states.size === 0, () => lens.clearStates()}>Any state</DropdownMenu.CheckboxItem>
      <DropdownMenu.Separator />
      {#each lenses as state (state)}
        <DropdownMenu.CheckboxItem closeOnSelect={false} bind:checked={() => lens.states.has(state), (on) => lens.selectState(state, on)}>
          {LENS_LABEL[state]}
        </DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  {#if sort}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={trigger(lens.sortMode !== 'manual')}>
        <ArrowDownWideNarrow class="size-3" />
        {SORT_LABEL[lens.sortMode]}
        <ChevronDown class="size-3 opacity-60" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="min-w-48">
        <DropdownMenu.Label>Sibling order</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={lens.sortMode} onValueChange={sortBy}>
          {#each SORT_MODES as mode (mode)}
            <DropdownMenu.RadioItem value={mode}>{SORT_LABEL[mode]}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

  {#if diff && store}
    <Tooltip text={diffOn ? 'Show the current version' : 'Compare with the version you saw last time you were here'}>
      <a href={diffHref} class={trigger(diffOn)}>
        <GitCompare class="size-3" />
        Diff
      </a>
    </Tooltip>
  {/if}

  {#if store && !lens.active}
    <Tooltip text={store.anyOpen ? 'Collapse all' : 'Expand back'}>
      <button
        type="button"
        class={cn(
          'ml-0.5 grid size-6 place-items-center rounded-full text-muted-foreground transition-all duration-150 ease-instrument hover:bg-hover hover:text-foreground',
          store.anyOpen || store.canOpenBack ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-label={store.anyOpen ? 'Collapse all' : 'Expand back'}
        onclick={() => (store.anyOpen ? store.closeAll() : store.openBack())}
      >
        {#if store.anyOpen}
          <ChevronsDownUp class="size-3.5" />
        {:else}
          <ChevronsUpDown class="size-3.5" />
        {/if}
      </button>
    </Tooltip>
  {/if}

  <Tooltip text="Clear filters">
    <button
      type="button"
      class={cn(
        'grid size-6 place-items-center rounded-full text-muted-foreground transition-all duration-150 ease-instrument hover:bg-hover hover:text-foreground',
        dirty ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-label="Clear filters"
      onclick={() => lens.clear()}
    >
      <X class="size-3" />
    </button>
  </Tooltip>
</div>
