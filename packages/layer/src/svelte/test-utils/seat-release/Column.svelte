<script lang="ts">
  import { flushSync, getContext, onDestroy } from 'svelte';
  import Row from './Row.svelte';
  import type { Seat, SeatWorld } from './world.svelte.js';

  let { host, tick }: { host: Seat; tick: number } = $props();

  const world = getContext<SeatWorld>('seat-world');
  onDestroy(() => {
    if (world.settles) flushSync();
  });
</script>

<Row active={host.active} {tick} />
