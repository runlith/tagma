<script lang="ts">
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { holdGraph } from '$lib/features/workspace/holds.js';
  import { placedBlockOf } from './blockPane.js';

  let { pane }: { pane: SidePane } = $props();

  const placed = untrack(() => placedBlockOf(pane.id));
  if (placed !== null) holdGraph({ projectId: placed.projectId, branch: placed.branch });
</script>
