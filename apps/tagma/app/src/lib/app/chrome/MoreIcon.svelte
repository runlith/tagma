<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="2.5" y="7" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
  <rect x="7" y="7" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
  <rect x="11.5" y="7" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
</Glyph>
