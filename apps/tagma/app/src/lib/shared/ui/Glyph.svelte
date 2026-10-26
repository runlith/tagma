<script lang="ts">
  import type { Snippet } from 'svelte';

  let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<svg
  class={className}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@render children()}
</svg>
