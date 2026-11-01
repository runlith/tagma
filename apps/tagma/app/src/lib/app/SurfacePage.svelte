<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import ShownPayload from '@runlith/layer/svelte/ShownPayload.svelte';
  import AbsentSurface from '$lib/features/workspace/AbsentSurface.svelte';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

  const router = Router.use();
  const surfaces = SurfaceRegistry.use();
  const shown = $derived(surfaces.find(surfaces.of(router.routeId, router.params)));
  const path = $derived(router.params.path ?? '');
</script>

{#if shown?.payload !== undefined}
  {#key shown.payload.component}
    <ShownPayload id={`Surfaces/${shown.surface}`} payload={shown.payload} props={{ path }} />
  {/key}
{:else}
  <AbsentSurface {path} />
{/if}
