<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import BlockPage from './block/BlockPage.svelte';
  import type { PlacedBlock } from './blockPane.js';

  let { placed }: { placed: PlacedBlock } = $props();

  const held = untrack(() => placed);
  holdProject(held.projectId);
  App.hold(GraphRung, { projectId: held.projectId, branch: held.branch });
</script>

<div class="@container/page h-full min-h-0 overflow-y-auto">
  <BlockPage blockName={held.name} diff={held.diff} lang={held.lang} aside />
</div>
