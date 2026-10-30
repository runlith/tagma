<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import Conversation from '$lib/features/threads/native/Conversation.svelte';
  import { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
  import { followHome } from '$lib/features/threads/followHome.svelte.js';
  import ThreadHeading from '$lib/features/threads/Heading.svelte';
  import { SidePanes } from '../panes/SidePanes.svelte.js';
  import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
  import { Bar } from '../panes/Bar.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';

  let { children }: { children: Snippet } = $props();

  const panes = SidePanes.use();
  const seats = ThreadSeats.use();
  const workspace = Workspace.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const shell = shellActs(ShellOps.use(), Notices.use());

  const host = ThreadSlot.start(App.section('chat', 'project'), {
    app: App.current(),
    writer: {
      navigate: (sessionId) => {
        if (sessionId !== null && host.activeId === null) panes.carry(sessionId);
        void router.goto(addresses.thread(sessionId), { keepFocus: true });
      },
      open: (sessionId) => {
        if (!seats.reveal(sessionId)) void shell.openThread({ projectId: host.projectId, threadId: sessionId }, 'main');
      },
      rehome: (projectId) => {
        const project = workspace.find(projectId);
        if (project !== null) void router.goto(addresses.thread(null, project.name), { keepFocus: true });
      },
    },
    context: { scopeName: () => addresses.scope },
  });
  const unseat = seats.seatMain(host);
  followHome(host, workspace, (thread, home) => void router.goto(addresses.thread(thread.threadId, home.name), { replaceState: true }));

  let routed: string | null | undefined;
  $effect(() => {
    const projectId = workspace.activeId;
    const sessionId = typeof router.params.id === 'string' ? router.params.id : null;
    untrack(() => {
      host.activateRoute(sessionId, projectId);
      if (routed !== undefined && routed !== sessionId) panes.focusOn(null);
      routed = sessionId;
    });
  });

  onDestroy(unseat);

  const graphAim = GraphRung.Source.use();
  const graphKey = $derived.by(() => {
    const aim = graphAim();
    return aim === undefined ? null : GraphRung.keyOf(aim);
  });

  const bar = Bar.use();
  $effect(() => bar.hold(zone));
</script>

{#snippet zone()}
  <ThreadHeading {host} />
{/snippet}

<main class="relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
  <div class="min-h-0 min-w-0">
    {#if graphKey !== null}
      {#key graphKey}
        <Conversation {host} />
      {/key}
    {/if}
  </div>
  {@render children()}
</main>
