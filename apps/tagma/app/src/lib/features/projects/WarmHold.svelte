<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { GraphRung, type GraphAim } from '../workspace/GraphRung.js';
  import { ProjectRung } from '../workspace/ProjectRung.js';

  let { aim }: { aim: GraphAim } = $props();

  const held = untrack(() => aim);
  App.hold(ProjectRung, { projectId: held.projectId });
  App.hold(GraphRung, held);
</script>
