<script lang="ts">
  import Branch from './Branch.svelte';
  import type { EagerWorld } from './world.svelte.js';

  let { world }: { world: EagerWorld } = $props();

  $effect(() => {
    if (world.closing) world.open = false;
  });

  $effect(() => {
    world.seen = world.ticks;
  });
</script>

{#if world.open}
  <Branch {world} />
{/if}
