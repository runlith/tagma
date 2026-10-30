<script lang="ts">
  import { untrack } from 'svelte';
  import { holdGraph } from '$lib/features/workspace/holds.js';
  import CommitView from './CommitView.svelte';

  let { projectId, sha }: { projectId: number; sha: string } = $props();

  const held = untrack(() => projectId);
  holdGraph({ projectId: held, branch: null });
</script>

<CommitView projectId={held} {sha} />
