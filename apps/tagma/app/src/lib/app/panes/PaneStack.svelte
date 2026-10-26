<script lang="ts">
  import PaneMount from './PaneMount.svelte';
  import { SidePanes } from './SidePanes.svelte.js';

  const panes = SidePanes.use();
  const active = $derived(panes.layout.active);
  const mounted = $derived(panes.panes.filter((tab) => tab.key === active || panes.kinds.find(tab.kind)?.keep === true));
</script>

{#each panes.panes as tab (`${tab.key}:${tab.id}`)}
  {@const Hold = panes.kinds.find(tab.kind)?.hold}
  {#if Hold}<Hold pane={tab} />{/if}
{/each}

{#each mounted as tab (tab.key)}
  <div class="absolute inset-0 min-h-0 min-w-0" hidden={tab.key !== active} data-tab-view={tab.key}>
    <PaneMount pane={tab} />
  </div>
{/each}
