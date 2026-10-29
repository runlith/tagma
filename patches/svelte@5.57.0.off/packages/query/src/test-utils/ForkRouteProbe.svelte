<script lang="ts">
  import type { BaseQuery } from '../types.js';
  import type { Signal } from './signal.svelte.js';
  import AutoAttachProbe from './AutoAttachProbe.svelte';

  type Route = 'game' | 'lobby';

  type Props = {
    route: Signal<Route>;
    query: BaseQuery<unknown>;
  };

  let { route, query }: Props = $props();
  const current = $derived(route.get());
</script>

<div data-testid="route">{current}</div>

{#if current === 'lobby'}
  <AutoAttachProbe {query} />
{/if}
