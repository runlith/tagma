<script lang="ts">
  import type { SurfaceProps } from '$lib/features/workspace/surface.js';
  import SectionPage from './SectionPage.svelte';
  import { sectionAt } from './sectionPath.js';

  let { path }: SurfaceProps = $props();

  const at = $derived(sectionAt(path));
</script>

{#if at !== null}
  <SectionPage tagmaApp={at.tagmaApp} view={at.view} />
{/if}
