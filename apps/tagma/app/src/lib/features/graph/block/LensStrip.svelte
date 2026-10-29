<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';

  let {
    word,
    leave,
    href,
    onleave,
    end,
    children,
  }: {
    word: string;
    leave: string;
    href: string | null;
    onleave?: () => void;
    end?: Snippet;
    children: Snippet;
  } = $props();

  const act = 'flex items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground';
</script>

<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand/35 bg-brand/5 px-3 py-2">
  <span class="eyebrow shrink-0 text-brand">{word}</span>
  {@render children()}
  <span class="ml-auto flex items-center gap-3">
    {@render end?.()}
    {#if href === null}
      <button type="button" class={act} onclick={onleave}><X class="size-3" />{leave}</button>
    {:else}
      <a {href} class={act}><X class="size-3" />{leave}</a>
    {/if}
  </span>
</div>
