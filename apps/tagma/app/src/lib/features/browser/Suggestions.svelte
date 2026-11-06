<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import RowLead from '$lib/shared/ui/dropdown-menu/dropdown-menu-lead.svelte';
  import RowTail from '$lib/shared/ui/dropdown-menu/dropdown-menu-tail.svelte';
  import { ROW } from '$lib/shared/ui/dropdown-menu/row.js';
  import { cn } from '$lib/shared/utils.js';
  import { shownOf } from './address.js';
  import type { Omnibox } from './Omnibox.svelte.js';
  import PageIcon from './PageIcon.svelte';
  import { keyOf, spotted, type Suggestion } from './suggestions.js';

  let { omnibox, id }: { omnibox: Omnibox; id: string } = $props();

  const keymap = Keymap.use();
  const enter = keymap.spellText('Enter');
  const query = $derived(omnibox.typed.trim());

  const inView = (option: HTMLElement): void => option.scrollIntoView({ block: 'nearest' });

  const labelOf = (row: Suggestion): string | undefined =>
    row.kind === 'served' || row.kind === 'go' ? (row.label ?? undefined) : undefined;
</script>

{#snippet searching()}<span class="text-small text-muted-foreground">Search</span>{/snippet}
{#snippet switching()}<span class="text-small text-muted-foreground">Switch</span>{/snippet}

{#each omnibox.rows as row, index (keyOf(row))}
  {@const chosen = index === omnibox.chosen}
  {@const label = labelOf(row)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    id="{id}-{index}"
    role="option"
    tabindex="-1"
    aria-selected={chosen}
    data-highlighted={chosen ? '' : undefined}
    class={cn(ROW, !chosen && 'hover:bg-hover')}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => omnibox.choose(row)}
    {@attach chosen ? inView : null}
  >
    <RowLead>
      {#snippet lead()}
        {#if row.kind === 'search'}<Search class="size-3.5" />{:else}<PageIcon icon={row.icon} />{/if}
      {/snippet}
    </RowLead>
    {#snippet words(classes: string)}
      <FadeText class={classes}>
        {#if row.kind === 'search'}
          <span>{row.query}</span>
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
    {/snippet}
    {#if row.kind !== 'search' && row.kind !== 'open' && label !== undefined}
      <span data-line class="flex-1">{@render words('')}<RowTail hint={label} /></span>
    {:else}
      {@render words('flex-1')}
      {#if row.kind === 'search'}
        <RowTail tail={searching} />
      {:else if row.kind === 'open'}
        <RowTail tail={switching} />
      {:else if chosen}
        <RowTail keys={enter} />
      {/if}
    {/if}
  </div>
{/each}
