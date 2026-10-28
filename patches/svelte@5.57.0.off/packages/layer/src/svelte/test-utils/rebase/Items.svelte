<script lang="ts">
  import type { RebaseWorld } from './world.svelte.js';

  let { world }: { world: RebaseWorld } = $props();

  const items = $derived([world.a * world.b]);
</script>

{#each items as n, index (index)}
  <p data-testid="item">item {n}</p>
{/each}
<p>{world.c}</p>
<p>{await world.slow(world.a)}</p>
