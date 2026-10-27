<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import type { SeatWorld } from './world.svelte.js';

  const world = getContext<SeatWorld>('seat-world');

  world.seat = { active: 'one' };
  onDestroy(() => {
    world.seat = null;
  });
</script>

<p data-testid="page"></p>
