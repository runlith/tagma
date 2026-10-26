<script lang="ts">
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { shownOf } from './panes.js';
  import ProjectPane from './ProjectPane.svelte';

  let { pane, close }: { pane: SidePane; close: () => void } = $props();

  const own = ProjectRung.Current.use().projectId;
  const project = $derived(shownOf(pane.id)?.project ?? own);
</script>

{#key project}
  <ProjectPane {pane} {close} {project} />
{/key}
