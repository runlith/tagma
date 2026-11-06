<script lang="ts">
  import PaneGraph from '$lib/app/panes/PaneGraph.svelte';
  import Conversation from '../native/Conversation.svelte';
  import type { ThreadSlot } from '../ThreadSlot.svelte.js';

  let { host, projectId, fallback, label }: { host: ThreadSlot; projectId: number; fallback: string | null; label: string } = $props();

  const branch = $derived.by(() => {
    const id = host.activeId;
    if (id === null || !host.places.known) return fallback;
    const row = host.places.placeOf(id);
    return row === null || row.kind === 'main' ? null : row.branch;
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label={label}>
  <div class="min-h-0 min-w-0 flex-1">
    {#key branch}
      <PaneGraph aim={{ projectId, branch }}>
        <Conversation {host} />
      </PaneGraph>
    {/key}
  </div>
</section>
