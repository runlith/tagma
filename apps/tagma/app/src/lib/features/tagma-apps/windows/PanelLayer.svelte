<script lang="ts">
  import { FloatingPanels } from './FloatingPanels.svelte.js';
  import FloatingPanel from './FloatingPanel.svelte';
  import { windowKey } from './ViewWindows.js';

  let { projectId }: { projectId: number } = $props();

  const floating = FloatingPanels.use();
  const shown = $derived(floating.panels.filter((panel) => panel.address.projectId === projectId));
  const order = $derived(new Map(shown.toSorted((left, right) => left.raised - right.raised).map((panel, rank) => [panel, rank])));
</script>

<div class="pointer-events-none fixed inset-0 z-40">
  {#each shown as panel, index (windowKey(panel.address))}
    <FloatingPanel
      address={panel.address}
      layer={order.get(panel) ?? 0}
      {index}
      onclose={() => floating.close(panel.address)}
      onraise={() => floating.raise(panel.address)}
    />
  {/each}
</div>
