<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="grid h-full place-items-center px-6" data-absent>
  <div class="max-w-sm text-center">
    <h1 class="text-page">{title}</h1>
    <p class="mt-2 text-body leading-relaxed text-muted-foreground">{@render children()}</p>
  </div>
</div>
