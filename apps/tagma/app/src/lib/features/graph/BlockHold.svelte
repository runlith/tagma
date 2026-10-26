<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { placedBlockOf } from './blockPane.js';

  let { pane }: { pane: SidePane } = $props();

  const placed = untrack(() => placedBlockOf(pane.id));
  if (placed !== null) {
    App.hold(ProjectRung, { projectId: placed.projectId });
    App.hold(GraphRung, { projectId: placed.projectId, branch: placed.branch });
  }
</script>
