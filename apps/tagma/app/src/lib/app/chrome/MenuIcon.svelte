<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
</Glyph>
