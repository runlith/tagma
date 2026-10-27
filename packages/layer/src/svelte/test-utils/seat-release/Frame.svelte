<script lang="ts">
  import { setContext, untrack } from 'svelte';
  import Column from './Column.svelte';
  import Page from './Page.svelte';
  import type { SeatWorld } from './world.svelte.js';

  let { world }: { world: SeatWorld } = $props();
  setContext(
    'seat-world',
    untrack(() => world),
  );
</script>

<svelte:boundary onerror={(error) => world.failures.push(error)}>
  {#if world.open}
    <Page />
  {/if}
  {#if world.seat !== null}
    {#key world.seat}
      <Column host={world.seat} tick={world.tick} />
    {/key}
  {/if}
  {#snippet failed()}{/snippet}
</svelte:boundary>
