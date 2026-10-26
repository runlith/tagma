<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { BlocksRepo } from './BlocksRepo.js';
  import { refusalOf } from '$lib/wire/refusal.js';

  let { name }: { name: string } = $props();

  const aim = GraphRung.Current.use();
  const workspace = Workspace.use();
  const blocks = BlocksRepo.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const lookup = $derived(blocks.titles.key([name]));
  const found = $derived(lookup.data?.titles[0]);
  let failure = $state<unknown>(null);
  const unreadable = $derived(found === undefined ? lookup.data?.unreadable.find((copy) => copy.names.includes(name)) : undefined);
  const problem = $derived(lookup.error ?? failure ?? (unreadable === undefined ? undefined : refusalOf(unreadable.error)));

  $effect(() => {
    const target = found;
    if (target === undefined || (target.projectId === aim.projectId && target.branch === undefined)) return;
    let disposed = false;
    void workspace
      .nameOf(target.projectId)
      .then(async (project) => {
        if (!disposed) await router.goto(addresses.block(target.name, { project, branch: target.branch }), { replaceState: true });
      })
      .catch((error: unknown) => {
        if (!disposed) failure = error;
      });
    return () => {
      disposed = true;
    };
  });
</script>

<div class="grid h-full place-items-center px-6">
  <div class="max-w-sm text-center">
    <h1 class="text-page">
      {lookup.isFetching ? 'Looking for this block' : problem ? 'Could not locate this block' : 'No such block'}
    </h1>
    <p class="mt-2 text-body leading-relaxed text-muted-foreground">
      {#if problem}
        {String(problem)}
      {:else if lookup.isFetching || found !== undefined}
        Finding <span class="font-mono">{name}</span> in the project's graph copies.
      {:else}
        The project's available graph copies hold no block named <span class="font-mono">{name}</span>.
      {/if}
    </p>
  </div>
</div>
