<script lang="ts">
  import Row from './Row.svelte';
  import type { Slot } from './world.svelte.js';

  let { host, tick }: { host: Slot; tick: number } = $props();
</script>

<Row active={host.active} {tick} />
