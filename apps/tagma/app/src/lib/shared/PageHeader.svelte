<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';

  let {
    title,
    caption,
    actions,
    scope,
    class: className,
  }: {
    title: string;
    caption?: string | Snippet;
    actions?: Snippet;
    scope?: Snippet;
    class?: ClassValue;
  } = $props();
</script>

<header class={['grid gap-1', className]}>
  {#if scope}
    <div class="mb-2 flex">{@render scope()}</div>
  {/if}
  <div class="flex min-w-0 items-center gap-3">
    <h1 class="min-w-0 flex-1 truncate text-title">{title}</h1>
    {#if actions}
      <div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
    {/if}
  </div>
  {#if typeof caption === 'string'}
    <p class="text-ui text-muted-foreground">{caption}</p>
  {:else if caption}
    <p class="text-ui text-muted-foreground">{@render caption()}</p>
  {/if}
</header>
