<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="2.5" y="2.5" width="11" height="11" rx="1.25" />
  <path d="M5 6l2 2-2 2" />
  <path d="M8.5 10.5H11" />
</Glyph>
