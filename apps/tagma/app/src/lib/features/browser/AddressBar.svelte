<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import type { Snippet } from 'svelte';
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { partsOf } from './address.js';
  import type { Omnibox } from './Omnibox.svelte.js';
  import PageIcon from './PageIcon.svelte';
  import Suggestions from './Suggestions.svelte';
  import type { Suggestion } from './suggestions.js';

  let {
    omnibox,
    page,
    list,
    profile,
    end,
  }: {
    omnibox: Omnibox;
    page: Page | null;
    list: string;
    profile: string | null;
    end?: Snippet;
  } = $props();

  const PLACEHOLDER = 'Search or type an address';

  const address = $derived(omnibox.address());
  const parts = $derived(partsOf(address));
  const listed = $derived(omnibox.open && omnibox.rows.length > 0);
  const leading = $derived<Suggestion | undefined>(
    omnibox.chosen >= 0 ? omnibox.rows[omnibox.chosen] : omnibox.typed.trim() === '' ? undefined : omnibox.rows[0],
  );
</script>

<div class="relative flex h-7 min-w-0 flex-1">
  {#if page === null || omnibox.open}
    <label
      class="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 rounded-md border border-transparent bg-hover px-2 transition-colors focus-within:border-ring focus-within:bg-field"
    >
      <span class="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
        {#if leading?.kind === 'search' || (leading === undefined && page === null)}
          <Search class="size-3.5" />
        {:else}
          <PageIcon icon={leading?.icon ?? page?.favicon ?? null} />
        {/if}
      </span>
      <input
        class="h-full min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
        type="text"
        role="combobox"
        aria-label="Address"
        aria-autocomplete="both"
        aria-expanded={listed}
        aria-controls={list}
        aria-activedescendant={listed && omnibox.chosen >= 0 ? `${list}-${omnibox.chosen}` : undefined}
        placeholder={PLACEHOLDER}
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        {@attach omnibox.input}
        oninput={(event) => omnibox.typing(event)}
        onkeydown={(event) => omnibox.keydown(event)}
        onfocus={(event) => {
          omnibox.focused();
          event.currentTarget.select();
        }}
        onblur={() => omnibox.blurred()}
      />
    </label>
  {:else}
    <div
      class="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent bg-hover pr-1 transition-colors hover:bg-selected"
    >
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 rounded-md pl-2 text-left text-ui outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
        aria-label="Address"
        onclick={() => omnibox.edit()}
      >
        <span class="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
          <PageIcon icon={page.favicon} loading={page.live.loading} />
        </span>
        {#if profile !== null}
          <span class="flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-sm bg-selected px-1.5 text-meta text-foreground">
            <UserRound class="size-3 shrink-0" /><FadeText text={profile} />
          </span>
        {/if}
        <FadeText class="flex-1">
          {#if address === ''}
            <span class="text-muted-foreground">{PLACEHOLDER}</span>
          {:else if parts.query !== null}
            <span>{parts.query}</span><span class="pl-2 text-muted-foreground">Google Search</span>
          {:else}
            <span class="text-muted-foreground">{parts.scheme}</span><span>{parts.host}</span><span class="text-muted-foreground"
              >{parts.rest}</span
            >
          {/if}
        </FadeText>
      </button>
      {@render end?.()}
    </div>
  {/if}
  {#if listed}
    <div
      id={list}
      role="listbox"
      aria-label="Suggestions"
      class="absolute inset-x-0 top-full z-10 mt-1 flex flex-col rounded-lg border bg-popover p-1 text-popover-foreground shadow-float"
      {@attach overlayLayers.notice}
    >
      <Suggestions {omnibox} id={list} />
    </div>
  {/if}
</div>
