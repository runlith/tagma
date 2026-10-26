<script lang="ts">
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import WorkSections from './WorkSections.svelte';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const panes = SidePanes.use();
  const thread = $derived(panes.main?.activeId ?? null);
  const projectId = $derived(panes.main?.projectId ?? null);
</script>

<div class="h-full min-h-0 min-w-0 overflow-y-auto" data-work-pane={pane.key}>
  {#if thread !== null && projectId !== null}
    {#key `${projectId}|${thread}`}
      <WorkSections {projectId} threadId={thread} />
    {/key}
  {:else}
    <p class="p-4 text-ui text-muted-foreground">Work belongs to a thread. Open one to see what it works on and did in the graph.</p>
  {/if}
</div>
