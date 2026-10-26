<script lang="ts">
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { placedBlockOf } from './blockPane.js';
  import BlockSeat from './BlockSeat.svelte';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const placed = $derived(placedBlockOf(pane.id));
</script>

{#if placed !== null}
  {#key pane.id}
    <BlockSeat {placed} />
  {/key}
{/if}
