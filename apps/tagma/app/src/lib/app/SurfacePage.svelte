<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import ShownPayload from '@runlith/layer/svelte/ShownPayload.svelte';
  import SectionPage from '$lib/features/tagma-apps/SectionPage.svelte';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

  const router = Router.use();
  const surfaces = SurfaceRegistry.use();
  const shown = $derived(surfaces.find(surfaces.of(router.routeId, router.params)));
  const path = $derived(router.params.path ?? '');
</script>

{#snippet section(view: { tagmaApp: string; view: string })}
  <SectionPage tagmaApp={view.tagmaApp} view={view.view} />
{/snippet}

{#if shown?.payload !== undefined}
  {#key shown.surface}
    <ShownPayload id={`Surfaces/${shown.surface}`} payload={shown.payload} props={{ path }} view={section} />
  {/key}
{/if}
