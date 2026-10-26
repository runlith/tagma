<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack, type Snippet } from 'svelte';
  import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';

  let { aim, children }: { aim: GraphAim; children: Snippet } = $props();

  App.hold(
    GraphRung,
    untrack(() => aim),
  );
</script>

{@render children()}
