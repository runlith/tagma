<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { GuardWorld } from './world.svelte.js';

  let { world }: { world: GuardWorld } = $props();

  onDestroy(() => {
    world.grip = { size: 3 };
    world.holding = false;
  });
</script>

<i data-testid="third"></i>
