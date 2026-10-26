<script lang="ts">
  import { tooltip } from '../tooltip.svelte.js';
  import Probe from './Probe.svelte';

  let { text, layered = false }: { text: string; layered?: boolean } = $props();
  let here = $state(true);
</script>

{#if here}
  <span data-tooltipped={text} {@attach tooltip.trigger(() => ({ text }))}>
    {#if layered}
      <Probe name={text} />
    {:else}
      <button data-target={text}>{text}</button>
      <input data-field={text} />
      <span data-wordless={text} {@attach tooltip.trigger(() => ({ text: null }))}>{text}</span>
    {/if}
  </span>
{/if}
<button data-remove={text} onclick={() => (here = false)}>remove</button>
