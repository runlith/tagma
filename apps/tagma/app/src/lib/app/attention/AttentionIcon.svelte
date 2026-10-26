<script lang="ts">
  import Glyph from '$lib/shared/ui/Glyph.svelte';

  let { class: className }: { class?: string } = $props();
</script>

<Glyph class={className}>
  <path d="M4 11V7.5A3.5 3.5 0 0 1 7.5 4h1A3.5 3.5 0 0 1 12 7.5V11l1.5 1.5h-11z" />
  <path d="M8 2v2" />
  <path d="M6.75 14.25a1.5 1.5 0 0 0 2.5 0" />
</Glyph>
