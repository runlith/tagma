<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M8 2.5l5.5 3h-11z" />
  <path d="M3.5 7.5v4M6.5 7.5v4M9.5 7.5v4M12.5 7.5v4M2.5 13.5h11" />
</Glyph>
