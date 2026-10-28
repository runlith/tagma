<script lang="ts">
  import Handle from './Handle.svelte';
  import Holder from './Holder.svelte';
  import type { GuardWorld } from './world.svelte.js';

  let { world }: { world: GuardWorld } = $props();
</script>

<svelte:boundary onerror={(error) => world.failures.push(error)}>
  {#if world.grip !== null}
    <Handle grip={world.grip} />
  {/if}
  {#if world.holding}
    <Holder {world} />
  {/if}
  {#snippet failed()}{/snippet}
</svelte:boundary>
