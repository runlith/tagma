<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import AbsentBlock from '$lib/features/graph/AbsentBlock.svelte';
  import TrashedBlock from '$lib/features/graph/TrashedBlock.svelte';
  import GraphView from '$lib/features/graph/spatial/GraphView.svelte';
  import ScopeChip from '$lib/features/graph/ScopeChip.svelte';
  import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
  import { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';

  const addresses = Addresses.use();
  const store = TreeScreen.mount({ reading: 'graph', root: addresses.scope ?? undefined });
  const selection = GraphSelection.use();

  $effect(() => () => {
    selection.name = null;
  });

  const scope = $derived(addresses.scope);

  $effect(() => {
    store.load(addresses.scope ?? undefined);
  });
</script>

<div class="relative h-full">
  {#if store.rootAbsent && scope !== null}
    {#if store.trashRoots.some((row) => row.name === scope)}
      <TrashedBlock name={scope} {store} />
    {:else}
      <AbsentBlock name={scope} />
    {/if}
  {:else}
    <GraphView {store} />
    {#if scope !== null}
      <ScopeChip name={scope} block={store.block(scope)} surface="graph" class="absolute top-4 left-4 z-10" />
    {/if}
  {/if}
</div>
