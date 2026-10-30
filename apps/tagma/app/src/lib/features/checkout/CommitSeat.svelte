<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import CommitView from './CommitView.svelte';

  let { projectId, sha }: { projectId: number; sha: string } = $props();

  const held = untrack(() => projectId);
  holdProject(held);
  App.hold(GraphRung, { projectId: held, branch: null });
</script>

<CommitView projectId={held} {sha} />
