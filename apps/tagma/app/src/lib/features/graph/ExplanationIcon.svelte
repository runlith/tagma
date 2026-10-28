<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="2.5" y="2.5" width="11" height="11" rx="1.25" />
  <rect x="7.25" y="4.75" width="1.5" height="1.5" rx="0.4" fill="currentColor" stroke="none" />
  <path d="M8 8v3.5" />
</Glyph>
