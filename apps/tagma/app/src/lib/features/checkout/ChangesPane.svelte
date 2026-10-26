<script lang="ts">
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import ThreadHold from '$lib/features/workspace/ThreadHold.svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import Changes from './Changes.svelte';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const panes = SidePanes.use();
  const graphAim = GraphRung.Source.use();
  const thread = $derived(panes.main?.activeId ?? null);
  const graphKey = $derived.by(() => {
    const aim = graphAim();
    return aim === undefined ? null : GraphRung.keyOf(aim);
  });
</script>

<div class="h-full min-h-0 min-w-0" data-changes-pane={pane.key}>
  {#if thread !== null && graphKey !== null}
    {#key `${thread}|${graphKey}`}
      <ThreadHold {thread}>
        <Changes />
      </ThreadHold>
    {/key}
  {:else}
    <p class="p-4 text-ui text-muted-foreground" data-changes-threadless>Changes belong to a thread. Open one to see what it changed.</p>
  {/if}
</div>
