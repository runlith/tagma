<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="5.5" y="2.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
  <rect x="2" y="10.5" width="3" height="3" rx="0.75" />
  <rect x="10" y="10.5" width="3" height="3" rx="0.75" />
  <path d="M7.5 6.5v2M3.5 10.5v-1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" />
</Glyph>
