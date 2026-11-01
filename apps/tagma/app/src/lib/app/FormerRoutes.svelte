<script lang="ts">
  import { untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

  const router = Router.use();
  const surfaces = SurfaceRegistry.use();

  $effect(() => {
    if (router.routeId != null) return;
    const moved = surfaces.moved(router.url);
    if (moved !== null) untrack(() => void router.replace(moved));
  });
</script>
