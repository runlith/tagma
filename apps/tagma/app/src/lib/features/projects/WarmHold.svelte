<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import { GraphRung, type GraphAim } from '../workspace/GraphRung.js';
  import { holdProject } from '../workspace/holds.js';

  let { aim }: { aim: GraphAim } = $props();

  const held = untrack(() => aim);
  holdProject(held.projectId);
  App.hold(GraphRung, held);
</script>
