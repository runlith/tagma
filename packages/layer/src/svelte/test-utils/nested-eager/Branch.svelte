<script lang="ts">
  import { flushSync, onDestroy } from 'svelte';
  import type { EagerWorld } from './world.svelte.js';

  let { world }: { world: EagerWorld } = $props();

  onDestroy(() => {
    world.ticks += 1;
    flushSync();
  });
</script>

<p data-testid="branch">open</p>
