<script lang="ts">
  import { untrack } from 'svelte';
  import { holdGraph } from '$lib/features/workspace/holds.js';
  import BlockPage from './block/BlockPage.svelte';
  import type { PlacedBlock } from './blockPane.js';

  let { placed }: { placed: PlacedBlock } = $props();

  const held = untrack(() => placed);
  holdGraph({ projectId: held.projectId, branch: held.branch });
</script>

<div class="@container/page h-full min-h-0 overflow-y-auto">
  <BlockPage blockName={held.name} diff={held.diff} lang={held.lang} aside />
</div>
