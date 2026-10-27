<script lang="ts">
  import { untrack } from 'svelte';
  import Conversation from '$lib/features/threads/native/Conversation.svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import PaneGraph from '$lib/app/panes/PaneGraph.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { followHome } from '../followHome.svelte.js';
  import { threadSlot } from './threadSlot.svelte.js';
  import { ThreadSeats } from './ThreadSeats.svelte.js';

  let { pane, close }: { pane: SidePane; close: () => void } = $props();

  const seats = ThreadSeats.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const workspace = Workspace.use();
  const visits = Visits.use();
  const key = untrack(() => pane.key);
  const framing = GraphRung.Source.use();
  const { host, home, projectId } = threadSlot(seats, () => pane);
  followHome(host, (thread) => {
    close();
    void shell.openThread(thread, 'beside');
  });

  const topic = seats.take(key);
  if (topic?.kind === 'block') host.draft.stageMentions([{ name: topic.name, title: topic.title, tag: topic.tag }]);
  if (topic?.kind === 'text') host.draft.setText(topic.text);
  if (topic?.kind === 'piece') host.draft.stagePiece(topic.piece);
  if (topic?.kind === 'piece' && topic.ask !== undefined) host.draft.setText(topic.ask);
  let asking = topic?.kind === 'piece' && topic.ask !== undefined;

  $effect(() => {
    if (!asking || !host.canSend) return;
    asking = false;
    void host.writes.send();
  });

  let born = topic?.kind === 'text' ? topic.born : undefined;

  $effect(() => {
    const id = host.activeId;
    if (born === undefined || id === null) return;
    const tell = born;
    born = undefined;
    untrack(() => tell({ id, projectId }));
  });

  const framed = untrack(() => {
    if (home === null) return framing()?.branch ?? null;
    const project = workspace.find(home);
    return project === null ? null : visits.branchOf(project);
  });
  const branch = $derived.by(() => {
    const id = host.activeId;
    if (id === null || !host.places.known) return framed;
    const row = host.places.placeOf(id);
    return row === null || row.kind === 'main' ? null : row.branch;
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Thread beside">
  <div class="min-h-0 min-w-0 flex-1">
    {#key branch}
      <PaneGraph aim={{ projectId, branch }}>
        <Conversation {host} />
      </PaneGraph>
    {/key}
  </div>
</section>
