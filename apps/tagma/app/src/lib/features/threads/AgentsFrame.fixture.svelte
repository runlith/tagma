<script lang="ts">
  import AgentsFrame from './AgentsFrame.svelte';
  import { ThreadSeats } from './seats/ThreadSeats.svelte.js';
  import type { ThreadSlot } from './ThreadSlot.svelte.js';

  let { host, page }: { host: ThreadSlot; page: { open: boolean } } = $props();

  const seats = ThreadSeats.use();
</script>

{#if page.open}
  <span hidden {@attach () => seats.seatMain(host)}></span>
{/if}
<AgentsFrame />
