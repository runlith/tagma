<script lang="ts">
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { SidePanes } from './SidePanes.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const panes = SidePanes.use();
  const loading = untrack(() => panes.kinds.declared(pane.kind).view());
</script>

{#await loading then loaded}
  {@const View = loaded.default}
  <View {pane} close={() => panes.close(pane.key)} />
{/await}
