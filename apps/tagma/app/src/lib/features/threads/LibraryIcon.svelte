<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M8 4.25 2.5 3.25v9.25L8 13.75l5.5-1.25V3.25z" />
  <path d="M8 4.25v9.5" />
</Glyph>
