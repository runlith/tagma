<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M4.5 2.5v8" />
  <rect x="3" y="10.5" width="3" height="3" rx="0.75" />
  <rect x="10" y="3" width="3" height="3" rx="0.75" />
  <path d="M10 4.5H8.5a4 4 0 0 0-4 4" />
</Glyph>
