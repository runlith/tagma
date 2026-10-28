<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import RowLead from '$lib/shared/ui/dropdown-menu/dropdown-menu-lead.svelte';
  import RowTail from '$lib/shared/ui/dropdown-menu/dropdown-menu-tail.svelte';
  import { ROW } from '$lib/shared/ui/dropdown-menu/row.js';
  import { cn } from '$lib/shared/utils.js';
  import { shownOf } from './address.js';
  import type { Omnibox } from './Omnibox.svelte.js';
  import PageIcon from './PageIcon.svelte';
  import { keyOf, SECTIONS, spotted, type Suggestion } from './suggestions.js';

  let { omnibox, id, roomy = false }: { omnibox: Omnibox; id: string; roomy?: boolean } = $props();

  const keymap = Keymap.use();
  const enter = keymap.spell(keymap.bare('Enter'));
  const query = $derived(omnibox.typed.trim());

  const inView = (option: HTMLElement): void => option.scrollIntoView({ block: 'nearest' });

  const sectionOf = (index: number): string | null => {
    const row = omnibox.rows[index];
    if (row === undefined || row.kind === 'go' || row.kind === 'search') return null;
    return omnibox.rows[index - 1]?.kind === row.kind ? null : SECTIONS[row.kind];
  };

  const labelOf = (row: Suggestion): string | undefined =>
    row.kind === 'served' || row.kind === 'go' ? (row.label ?? undefined) : undefined;
</script>

{#each omnibox.rows as row, index (keyOf(row))}
  {@const section = sectionOf(index)}
  {@const chosen = index === omnibox.chosen}
  {@const label = labelOf(row)}
  {#if section !== null}<DropdownMenu.GroupHeading>{section}</DropdownMenu.GroupHeading>{/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    id="{id}-{index}"
    role="option"
    tabindex="-1"
    aria-selected={chosen}
    data-highlighted={chosen ? '' : undefined}
    class={cn(ROW, roomy && 'min-h-8', !chosen && 'hover:bg-hover')}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => omnibox.choose(row)}
    {@attach chosen ? inView : null}
  >
    <RowLead>
      {#snippet lead()}
        {#if row.kind === 'search'}<Search class="size-3.5" />{:else}<PageIcon icon={row.icon} />{/if}
      {/snippet}
    </RowLead>
    <FadeText class="flex-1">
      {#if row.kind === 'search'}
        <span>{row.query}</span><span class="pl-2 text-muted-foreground">Google Search</span>
      {:else if row.kind === 'go' || row.kind === 'served'}
        {@const shown = shownOf(row.url)}
        <span><MatchText text={shown} positions={spotted(shown, query)} /></span>{#if row.kind === 'go' && row.title !== null}<span
            class="pl-2 text-muted-foreground">{row.title}</span
          >{/if}
      {:else}
        {@const shown = shownOf(row.url)}
        <span><MatchText text={row.title} positions={spotted(row.title, query)} /></span><span class="pl-2 text-muted-foreground"
          ><MatchText text={shown} positions={spotted(shown, query)} /></span
        >
      {/if}
    </FadeText>
    {#if label !== undefined}
      <RowTail hint={label} />
    {:else if chosen}
      <RowTail keys={enter} />
    {/if}
  </div>
{/each}
