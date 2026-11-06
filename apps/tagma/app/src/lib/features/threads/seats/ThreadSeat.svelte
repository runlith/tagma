<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import PaneGraph from '$lib/app/panes/PaneGraph.svelte';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import Conversation from '../native/Conversation.svelte';
  import { ThreadSlot } from '../ThreadSlot.svelte.js';
  import { ThreadSeats } from './ThreadSeats.svelte.js';

  let { id }: { id: string } = $props();
  const seat = $props.id();

  const seats = ThreadSeats.use();
  const projectId = ProjectRung.Current.use().projectId;
  const beside = (threadId: string | null): void => {
    if (threadId === null || !seats.reveal(threadId)) seats.open({ home: null, threadId });
  };
  const host = ThreadSlot.start(App.section(`seat-${seat}`, 'project'), {
    app: App.current(),
    writer: { navigate: beside, open: beside, rehome: (home) => void seats.open({ home, threadId: null }) },
    context: { scopeName: () => null },
  });

  $effect(() => {
    const shown = id;
    untrack(() => host.activateRoute(shown, projectId));
  });

  const branch = $derived.by(() => {
    const active = host.activeId;
    if (active === null || !host.places.known) return null;
    const row = host.places.placeOf(active);
    return row === null || row.kind === 'main' ? null : row.branch;
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Thread">
  <div class="min-h-0 min-w-0 flex-1">
    {#key branch}
      <PaneGraph aim={{ projectId, branch }}>
        <Conversation {host} />
      </PaneGraph>
    {/key}
  </div>
</section>
