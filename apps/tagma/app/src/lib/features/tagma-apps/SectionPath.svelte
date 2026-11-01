<script lang="ts">
  import AbsentSurface from '$lib/features/workspace/AbsentSurface.svelte';
  import type { SurfaceProps } from '$lib/features/workspace/surface.js';
  import SectionPage from './SectionPage.svelte';
  import { sectionAt } from './sectionPath.js';

  let { path }: SurfaceProps = $props();

  const at = $derived(sectionAt(path));
</script>

{#if at !== null}
  <SectionPage tagmaApp={at.tagmaApp} view={at.view} />
{:else}
  <AbsentSurface {path} />
{/if}
