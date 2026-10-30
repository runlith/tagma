<script lang="ts">
  import type { HarnessPresentation } from '@tagma/server/threads/contract/wire/harness/externalSession';
  import ProviderMark from '$lib/features/providers/Mark.svelte';

  let { presentation, class: className = '' }: { presentation: HarnessPresentation; class?: string } = $props();
</script>

{#if presentation.mark != null}
  <span class="mark inline-flex shrink-0 {className}" role="img" aria-label={presentation.label}>{@html presentation.mark}</span>
{:else if presentation.iconProvider !== null}
  <ProviderMark provider={presentation.iconProvider} class={className} titled={false} />
{/if}

<style>
  .mark :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
