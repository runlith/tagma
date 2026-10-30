<script lang="ts">
  import type { ThreadPaneSlot } from './threadSlot.svelte.js';
  import PaneSeat from './PaneSeat.fixture.svelte';
  import type { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { paneThread } from './pane.js';
  import type { ThreadSeats } from './ThreadSeats.svelte.js';

  let { panes, seats, onSlot }: { panes: SidePanes; seats: ThreadSeats; onSlot: (slot: ThreadPaneSlot) => void } = $props();
</script>

{#each panes.panes as pane (pane.key)}
  {#key paneThread(pane.id).home}
    <PaneSeat {seats} {pane} {onSlot} />
  {/key}
{/each}
