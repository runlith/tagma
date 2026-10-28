<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import UserRound from '@lucide/svelte/icons/user-round';
  import type { Snippet } from 'svelte';
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { partsOf } from './address.js';
  import type { Omnibox } from './Omnibox.svelte.js';
  import PageIcon from './PageIcon.svelte';
  import Suggestions from './Suggestions.svelte';
  import type { Suggestion } from './suggestions.js';

  let {
    omnibox,
    page,
    row,
    list,
    profile,
    end,
  }: {
    omnibox: Omnibox;
    page: Page | null;
    row: HTMLElement | undefined;
    list: string;
    profile: string | null;
    end?: Snippet;
  } = $props();

  const PLACEHOLDER = 'Search or type an address';

  let field = $state<HTMLInputElement>();

  const address = $derived(omnibox.address());
  const parts = $derived(partsOf(address));
  const leading = $derived<Suggestion | undefined>(
    omnibox.chosen >= 0 ? omnibox.rows[omnibox.chosen] : omnibox.typed.trim() === '' ? undefined : omnibox.rows[0],
  );
  const anchor = $derived(
    row === undefined
      ? undefined
      : {
          element: row,
          rect: () => {
            const box = row.getBoundingClientRect();
            return { x: box.x + 4, y: box.y + 3, width: box.width - 8, height: 0 };
          },
        },
  );
</script>

{#snippet lead()}
  {#if leading?.kind === 'search'}
    <Search class="size-3.5" />
  {:else if leading !== undefined}
    <PageIcon icon={leading.icon} />
  {:else if page !== null}
    <PageIcon icon={page.favicon} />
  {:else}
    <Search class="size-3.5" />
  {/if}
{/snippet}

{#snippet entry(classes: string)}
  <input
    bind:this={field}
    class={classes}
    type="text"
    role="combobox"
    aria-label="Address"
    aria-autocomplete="both"
    aria-expanded={omnibox.rows.length > 0}
    aria-controls={list}
    aria-activedescendant={omnibox.chosen >= 0 ? `${list}-${omnibox.chosen}` : undefined}
    placeholder={PLACEHOLDER}
    autocapitalize="off"
    autocomplete="off"
    spellcheck="false"
    {@attach omnibox.input}
    oninput={(event) => omnibox.typing(event)}
    onkeydown={(event) => omnibox.keydown(event)}
    onfocus={(event) => event.currentTarget.select()}
  />
{/snippet}

{#if page === null}
  <label
    class="flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded-md border border-input bg-sunken px-2 transition-colors focus-within:border-ring"
  >
    <span class="grid size-3.5 shrink-0 place-items-center text-muted-foreground">{@render lead()}</span>
    {@render entry('h-full min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground')}
  </label>
{:else}
  <div class="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md bg-hover pr-1 transition-colors hover:bg-selected">
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
  <Popover.Root
    bind:open={() => omnibox.open, (next) => (omnibox.open = next)}
    onOpenChange={(next) => {
      if (!next) omnibox.close();
    }}
  >
    <Popover.Content
      {anchor}
      side="bottom"
      align="start"
      sideOffset={0}
      initialFocus={() => field ?? null}
      returnFocus={false}
      trapFocus={false}
      class="max-h-(--float-available-height) w-(--float-anchor-width) gap-0 overflow-hidden p-0 shadow-float"
    >
      <div class="flex h-8 shrink-0 items-center gap-2 px-3">
        <span class="grid size-3.5 shrink-0 place-items-center text-muted-foreground">{@render lead()}</span>
        {@render entry('h-full min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground')}
      </div>
      {#if omnibox.rows.length > 0}
        <div id={list} role="listbox" aria-label="Suggestions" class="min-h-0 overflow-y-auto border-t p-1">
          <Suggestions {omnibox} id={list} />
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}
