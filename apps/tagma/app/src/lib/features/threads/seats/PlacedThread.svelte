<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { ThreadSlot } from '../ThreadSlot.svelte.js';
  import SlotConversation from './SlotConversation.svelte';
  import { ThreadSeats } from './ThreadSeats.svelte.js';

  let { id }: { id: string } = $props();
  const uid = $props.id();
  const seat = `placed-${uid}`;

  const seats = ThreadSeats.use();
  const projectId = ProjectRung.Current.use().projectId;
  const host: ThreadSlot = ThreadSlot.start(App.section(seat, 'project'), {
    app: App.current(),
    pane: seat,
    writer: seats.placedWriter(() => host, projectId),
    context: { scopeName: () => null },
  });

  $effect(() => seats.seatPlaced(host));

  $effect(() => {
    const shown = id;
    untrack(() => host.activateRoute(shown, projectId));
  });
</script>

<SlotConversation {host} {projectId} fallback={null} label="Thread" />
