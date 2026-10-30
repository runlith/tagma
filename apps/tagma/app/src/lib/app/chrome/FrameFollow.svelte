<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { untrack } from 'svelte';
  import { branchHref } from '$lib/features/workspace/address.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';

  const seats = ThreadSeats.use();
  const router = Router.use();
  const worktrees = Worktrees.use();
  const projectId = ProjectRung.Current.use().projectId;
  const projectAim = ProjectRung.Source.use();

  $effect(() => {
    if (worktrees.stray) untrack(() => void router.replace(branchHref(router, null)));
  });

  $effect(() => {
    const host = seats.host;
    if (host === null || host.projectId !== projectId || projectAim()?.projectId !== projectId) return;
    const place = host.place;
    if (place === null || place.branch === null || place.missing) return;
    const aimed = router.url.searchParams.get('branch');
    if (aimed === place.branch || (aimed === null && place.kind === 'main')) return;
    untrack(() => void router.replace(branchHref(router, place.kind === 'main' ? null : place.branch)));
  });
</script>
