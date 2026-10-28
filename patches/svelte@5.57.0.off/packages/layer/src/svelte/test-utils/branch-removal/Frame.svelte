<script lang="ts">
  import Column from './Column.svelte';
  import type { BranchWorld } from './world.svelte.js';

  let { world }: { world: BranchWorld } = $props();
</script>

<svelte:boundary onerror={(error) => world.failures.push(error)}>
  {#if world.slot !== null}
    {#key world.slot}
      <Column host={world.slot} tick={world.tick} />
    {/key}
  {/if}
  <svelte:boundary>{await world.reach(world.slot)}</svelte:boundary>
  {#snippet failed()}{/snippet}
</svelte:boundary>
