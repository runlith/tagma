<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M2.5 8a5.5 5.5 0 1 0 5.5-5.5 6 6 0 0 0-4.15 1.7L2.5 5.5" />
  <path d="M2.5 2.5v3h3" />
  <path d="M8 5v3l2.25 1.25" />
</Glyph>
