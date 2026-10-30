<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import { placedBlockOf } from './blockPane.js';

  let { pane }: { pane: SidePane } = $props();

  const placed = untrack(() => placedBlockOf(pane.id));
  if (placed !== null) {
    holdProject(placed.projectId);
    App.hold(GraphRung, { projectId: placed.projectId, branch: placed.branch });
  }
</script>
