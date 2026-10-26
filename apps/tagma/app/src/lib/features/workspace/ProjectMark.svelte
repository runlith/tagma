<script lang="ts">
  import { Workspace } from './Selection.svelte.js';
  import { labelOf } from './mark.js';
  import FadeText from '$lib/shared/FadeText.svelte';

  let { projectId, class: className = '' }: { projectId: number; class?: string } = $props();

  const workspace = Workspace.use();
  const project = $derived(workspace.find(projectId));
  const label = $derived(project === null ? `project ${projectId}` : labelOf(project));
</script>

<FadeText
  class={['font-mono text-meta font-normal text-muted-foreground', className]}
  title={project === null ? undefined : `Lives in ${label}`}
  data-project-mark={projectId}
  text={label}
/>
