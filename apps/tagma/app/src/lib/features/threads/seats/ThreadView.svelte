<script lang="ts">
  import { untrack } from 'svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { followHome } from '../followHome.svelte.js';
  import SlotConversation from './SlotConversation.svelte';
  import { threadSlot } from './threadSlot.svelte.js';
  import { ThreadSeats } from './ThreadSeats.svelte.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const seats = ThreadSeats.use();
  const workspace = Workspace.use();
  const visits = Visits.use();
  const key = untrack(() => pane.key);
  const framing = GraphRung.Source.use();
  const { host, home, projectId } = threadSlot(seats, () => pane);
  followHome(host, workspace, (thread) =>
    seats.retarget(key, { home: thread.projectId === workspace.activeId ? null : thread.projectId, threadId: thread.threadId }),
  );

  const topic = seats.take(key);
  if (topic?.kind === 'block') host.draft.stageMentions([{ name: topic.name, title: topic.title, tag: topic.tag }]);
  if (topic?.kind === 'text') host.draft.setText(topic.text);
  if (topic?.kind === 'staged') host.draft.stage(topic.item);
  if (topic?.kind === 'staged' && topic.ask !== undefined) host.draft.setText(topic.ask);
  let asking = topic?.kind === 'staged' && topic.ask !== undefined;

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
</script>

<SlotConversation {host} {projectId} fallback={framed} label="Thread beside" />
