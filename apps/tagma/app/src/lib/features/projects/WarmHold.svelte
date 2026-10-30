<script lang="ts">
  import { untrack } from 'svelte';
  import type { GraphAim } from '../workspace/GraphRung.js';
  import { holdGraph } from '../workspace/holds.js';

  let { aim }: { aim: GraphAim } = $props();

  holdGraph(untrack(() => aim));
</script>
