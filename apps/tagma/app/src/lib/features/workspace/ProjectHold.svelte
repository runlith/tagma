<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack, type Snippet } from 'svelte';
  import { ProjectRung } from './ProjectRung.js';

  let { projectId, children }: { projectId: number; children: Snippet } = $props();

  App.hold(ProjectRung, { projectId: untrack(() => projectId) });
</script>

{@render children()}
