<script lang="ts">
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import LaunchersSync from './LaunchersSync.svelte';
  import PanelLayer from './windows/PanelLayer.svelte';
  import Reveals from './windows/Reveals.svelte';

  const workspace = Workspace.use();
  const projectId = $derived(workspace.contextProject?.id ?? null);
</script>

<Reveals />
{#if projectId !== null}
  {#key projectId}
    <LaunchersSync />
    <PanelLayer {projectId} />
  {/key}
{/if}
