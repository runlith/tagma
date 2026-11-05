<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="2.5" y="3.5" width="11" height="9" rx="1.25" />
  <path d="M2.5 6.5h11" />
  <rect x="4.15" y="4.4" width="1.2" height="1.2" rx="0.3" fill="currentColor" stroke="none" />
  <rect x="5.9" y="4.4" width="1.2" height="1.2" rx="0.3" fill="currentColor" stroke="none" />
</Glyph>
