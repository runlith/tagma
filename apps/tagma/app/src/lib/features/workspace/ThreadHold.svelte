<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack, type Snippet } from 'svelte';
  import { ThreadRung } from './ThreadRung.js';

  let { thread, children }: { thread: string; children: Snippet } = $props();

  App.hold(ThreadRung, { id: untrack(() => thread) });
</script>

{@render children()}
