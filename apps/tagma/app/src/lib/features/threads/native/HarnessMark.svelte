<script lang="ts">
  import type { HarnessName } from '@tagma/server/threads/contract/wire/harness/names';
  import { AgentTypes } from '../AgentTypes.svelte.js';
  import ProviderMark from '$lib/features/providers/Mark.svelte';

  let { harness, class: className = '' }: { harness: HarnessName; class?: string } = $props();

  const agents = AgentTypes.use();
  const adapter = $derived(agents.harness(harness));
  const provider = $derived(adapter?.iconProvider ?? null);
</script>

{#if adapter?.mark != null}
  <span class="mark inline-flex shrink-0 {className}" role="img" aria-label={adapter.label}>{@html adapter.mark}</span>
{:else if provider !== null}
  <ProviderMark {provider} class={className} titled={false} />
{/if}

<style>
  .mark :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
