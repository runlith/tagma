<script lang="ts">
  import type { Snippet } from 'svelte';
  import { partsHere } from '$lib/features/settings/parts.svelte.js';

  let {
    title,
    fact,
    act,
    children,
  }: {
    title?: string;
    fact?: Snippet;
    act?: Snippet;
    children: Snippet;
  } = $props();

  const parts = partsHere();
  let heading = $state<HTMLElement | null>(null);

  $effect(() => {
    const named = title;
    if (parts === undefined || heading === null || named === undefined) return;
    return parts.add({ title: named, heading });
  });
</script>

<section class={['grid', !(title || fact || act) && 'pt-4']} aria-label={title}>
  {#if title || fact || act}
    <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 pt-6 pb-1">
      {#if title}
        <h3 bind:this={heading} class="scroll-mt-16 text-ui font-semibold">{title}</h3>
      {/if}
      {#if fact}
        <div class="flex min-w-0 items-center gap-2 text-small text-muted-foreground">{@render fact()}</div>
      {/if}
      <span class="flex-1"></span>
      {@render act?.()}
    </div>
  {/if}
  <div class="grid">{@render children()}</div>
</section>
