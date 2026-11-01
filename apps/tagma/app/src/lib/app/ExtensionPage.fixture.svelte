<script lang="ts">
  import type { SurfaceProps } from '$lib/features/workspace/surface.js';

  let { path }: SurfaceProps = $props();
</script>

<p data-testid="extension-page" data-path={path}>extension page</p>
