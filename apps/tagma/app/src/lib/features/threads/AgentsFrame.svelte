<script lang="ts">
  import { AgentsColumn } from './AgentsColumn.svelte.js';
  import ThreadColumn from './Column.svelte';
  import { ThreadSeats } from './seats/ThreadSeats.svelte.js';

  const seats = ThreadSeats.use();
  const agents = AgentsColumn.use();
  const host = $derived(seats.page);
</script>

{#if host !== null}
  <ThreadColumn {host} onCollapse={() => agents.toggle()} />
{/if}
