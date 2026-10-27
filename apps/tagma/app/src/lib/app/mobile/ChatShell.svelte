<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
  import { followHome } from '$lib/features/threads/followHome.svelte.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Screen } from './Screen.svelte.js';
  import Thread from './Thread.svelte';
  import Threads from './Threads.svelte';

  let { children }: { children: Snippet } = $props();

  const DRAFT = 'new';

  const screen = Screen.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const workspace = Workspace.use();

  const project = $derived(router.params.project ?? '');
  const sessionId = $derived(typeof router.params.id === 'string' ? router.params.id : null);
  const drafting = $derived(sessionId === null && router.url.searchParams.has(DRAFT));
  const draftHref = $derived.by(() => {
    const threads = addresses.thread(null);
    return `${threads}${threads.includes('?') ? '&' : '?'}${DRAFT}`;
  });

  const host = ThreadSlot.start(App.section('chat', 'project'), {
    app: App.current(),
    writer: {
      navigate: (id) => void router.goto(id === null ? draftHref : addresses.thread(id), { replaceState: drafting, keepFocus: true }),
      open: (id) => void router.goto(addresses.thread(id), { replaceState: drafting }),
    },
  });
  const unseat = screen.seat(host);
  followHome(host, workspace, (thread, home) => void router.goto(addresses.thread(thread.threadId, home.name), { replaceState: true }));

  $effect(() => {
    const projectId = workspace.activeId;
    const id = sessionId;
    untrack(() => host.activateRoute(id, projectId));
  });

  onDestroy(unseat);
</script>

{#if sessionId !== null || drafting}
  <Thread {host} {project} />
{:else}
  <Threads {project} draft={draftHref} />
{/if}
{@render children()}
