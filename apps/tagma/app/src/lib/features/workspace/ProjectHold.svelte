<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { holdProject } from './holds.js';

  let { projectId, children }: { projectId: number; children: Snippet } = $props();

  holdProject(untrack(() => projectId));
</script>

{@render children()}
