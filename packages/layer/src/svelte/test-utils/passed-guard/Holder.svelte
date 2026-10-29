<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { GuardWorld } from './world.svelte.js';

  let { world }: { world: GuardWorld } = $props();

  onDestroy(() => {
    world.grip = null;
  });
</script>

<p data-testid="holder"></p>
