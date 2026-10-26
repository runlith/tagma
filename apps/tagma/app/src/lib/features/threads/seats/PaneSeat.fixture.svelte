<script lang="ts">
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { type ThreadPaneSlot, threadSlot } from './threadSlot.svelte.js';
  import type { ThreadSeats } from './ThreadSeats.svelte.js';

  let { seats, pane, onSlot }: { seats: ThreadSeats; pane: SidePane; onSlot: (slot: ThreadPaneSlot) => void } = $props();

  untrack(() => onSlot(threadSlot(seats, () => pane)));
</script>
