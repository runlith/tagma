<script lang="ts">
  import type { Grip } from './world.svelte.js';

  let { grip }: { grip: Grip } = $props();
  let measured = $state(0);

  $effect(() => {
    measured = grip.size;
  });
</script>

<b data-testid="handle">{measured}</b>
