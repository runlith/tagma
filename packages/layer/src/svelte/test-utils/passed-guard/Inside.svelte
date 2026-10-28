<script lang="ts">
  import Holder from './Holder.svelte';
  import type { GuardWorld } from './world.svelte.js';

  let { world }: { world: GuardWorld } = $props();
</script>

<svelte:boundary onerror={(error) => world.failures.push(error)}>
  {#if world.grip !== null}
    {#if world.holding}
      <Holder {world} />
    {/if}
    <b data-testid="size">{world.grip.size}</b>
  {/if}
  {#snippet failed()}{/snippet}
</svelte:boundary>
