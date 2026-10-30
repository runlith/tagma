<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import { ThreadList } from './List.svelte.js';

  let { projectId, children }: { projectId: number; children: Snippet } = $props();

  const home = untrack(() => projectId);
  if (ThreadList.use().covers(home)) holdProject(home);
</script>

{@render children()}
