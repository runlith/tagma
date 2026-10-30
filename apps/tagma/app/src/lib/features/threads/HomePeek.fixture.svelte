<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import HomeHold from './HomeHold.svelte';
  import ThreadPeek from './Peek.svelte';

  let { peek }: { peek: ComponentProps<typeof ThreadPeek> } = $props();
</script>

<HomeHold projectId={peek.node.row.projectId}><ThreadPeek {...peek} /></HomeHold>
