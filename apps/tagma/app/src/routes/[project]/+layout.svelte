<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { currentBranch, currentPlace } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { standingKey } from '$lib/features/workspace/standing.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';

  let { children } = $props();

  const workspace = Workspace.use();
  const visits = Visits.use();
  const router = Router.use();
  const surfaces = SurfaceRegistry.use();
  const addresses = Addresses.use();
  const projectAim = ProjectRung.Source.use();
  const graphAim = GraphRung.Source.use();
  const standing = $derived(standingKey(surfaces.get(surfaces.of(router.routeId)).stands, projectAim(), graphAim()));

  $effect(() => {
    const active = workspace.active;
    if (active) workspace.remember(active.name);
  });

  $effect(() => {
    const project = workspace.active?.name;
    const surface = surfaces.of(router.routeId);
    if (project === undefined) return;
    visits.remember(project, surface, currentPlace(router), currentBranch(router));
  });

  const title = $derived(addresses.title(workspace.active));
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if workspace.active && standing !== null}
  {#key standing}
    {@render children()}
  {/key}
{:else if workspace.loaded}
  <div class="grid h-full place-items-center px-6">
    <div class="max-w-sm text-center">
      <h1 class="text-page">No project named “{router.params.project}”</h1>
      <p class="mt-2 text-body leading-relaxed text-muted-foreground">
        The address points at a repository this Tagma does not track. Pick one from the project menu above.
      </p>
    </div>
  </div>
{/if}
