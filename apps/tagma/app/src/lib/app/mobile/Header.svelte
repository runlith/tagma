<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import type { Snippet } from 'svelte';
  import { Screen } from './Screen.svelte.js';

  let {
    title,
    caption,
    parent,
    lead,
    actions,
  }: {
    title: string;
    caption?: string | null;
    parent?: string;
    lead?: Snippet;
    actions?: Snippet;
  } = $props();

  const screen = Screen.use();
</script>

<header class="shrink-0 border-b bg-chrome">
  <div class="flex h-12 items-center gap-1 px-1">
    {#if parent !== undefined}
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded-full text-foreground active:bg-hover"
        aria-label="Back"
        onclick={() => screen.back(parent)}
      >
        <ChevronLeft class="size-4" />
      </button>
    {:else}
      <span class="w-3 shrink-0"></span>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col justify-center">
      <div class="flex min-w-0 items-center gap-2">
        {#if lead}{@render lead()}{/if}
        <h1 class="min-w-0 truncate text-body font-semibold">{title}</h1>
      </div>
      {#if caption}
        <p class="min-w-0 truncate text-small text-muted-foreground">{caption}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex shrink-0 items-center">{@render actions()}</div>
    {/if}
  </div>
</header>
