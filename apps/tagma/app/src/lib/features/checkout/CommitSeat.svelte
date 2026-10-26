<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import CommitView from './CommitView.svelte';

  let { projectId, sha }: { projectId: number; sha: string } = $props();

  const held = untrack(() => projectId);
  App.hold(ProjectRung, { projectId: held });
  App.hold(GraphRung, { projectId: held, branch: null });
</script>

<CommitView projectId={held} {sha} />
