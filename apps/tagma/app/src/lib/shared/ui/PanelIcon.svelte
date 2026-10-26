<script lang="ts">
  import Glyph from './Glyph.svelte';

  let { side, class: className }: { side: 'left' | 'right'; class?: string } = $props();
</script>

<Glyph class={className}>
  <rect x="2.5" y="2.5" width="11" height="11" rx="1.25" />
  <path d={side === 'left' ? 'M6.5 2.5v11' : 'M9.5 2.5v11'} />
</Glyph>
