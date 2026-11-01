<script lang="ts">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import { Router } from '@runlith/layer/Router';
  import SectionPage from '$lib/features/tagma-apps/SectionPage.svelte';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

  const router = Router.use();
  const surfaces = SurfaceRegistry.use();
  const shown = $derived(surfaces.find(surfaces.of(router.routeId, router.params)));
  const path = $derived(router.params.path ?? '');
</script>

{#if shown?.payload !== undefined}
  {@const payload = shown.payload}
  {#key shown.surface}
    <ErrorBoundary id={`Surfaces/${shown.surface}`}>
      {#if 'component' in payload}
        {@const Contributed = payload.component}
        <Contributed {path} />
      {:else}
        <SectionPage tagmaApp={payload.view.tagmaApp} view={payload.view.view} />
      {/if}
    </ErrorBoundary>
  {/key}
{/if}
