<script lang="ts">
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import FileView from './FileView.svelte';
  import { fileTargetOf } from './paneContent.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const panes = SidePanes.use();
  const graphAim = GraphRung.Source.use();
  const aimed = $derived(graphAim() ?? null);
  const graphKey = $derived(aimed === null ? null : GraphRung.keyOf(aimed));

  const target = $derived(fileTargetOf(pane.id));
  const projectId = $derived(target?.projectId ?? aimed?.projectId ?? null);
</script>

{#if target !== null && projectId !== null && graphKey !== null}
  {#key graphKey}
    <FileView {target} {projectId} opened={panes.opened(pane.key)} />
  {/key}
{/if}
