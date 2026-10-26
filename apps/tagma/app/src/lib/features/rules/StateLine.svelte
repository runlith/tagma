<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/shared/utils.js';

  let { title, children, class: className }: { title: string; children?: Snippet; class?: string } = $props();
</script>

<div class={cn('flex items-start gap-2 text-ui', className)}>
  <span class="mt-1.5 size-2 shrink-0 rounded-full bg-severity-lie"></span>
  <p class="min-w-0 leading-relaxed break-words">
    <span class="text-severity-lie">{title}</span>
    {#if children}
      <span class="text-muted-foreground">{@render children()}</span>
    {/if}
  </p>
</div>
