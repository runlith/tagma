<script lang="ts">
  import type { SurfaceProps } from '$lib/features/workspace/surface.js';
  import SectionPage from './SectionPage.svelte';

  let { path }: SurfaceProps = $props();

  const cut = $derived(path.indexOf('/'));
</script>

{#if cut > 0}
  <SectionPage tagmaApp={path.slice(0, cut)} view={path.slice(cut + 1)} />
{/if}
