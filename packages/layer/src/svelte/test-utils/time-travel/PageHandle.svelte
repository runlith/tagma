<script lang="ts">
  import { Engine, World } from './fixtures.svelte.js';

  const world = World.use();
  world.a = 1;
  const engine = Engine.use();
</script>

{#if engine.current}
  <p data-testid="found">{engine.current.find('book')}</p>
{:else}
  <p data-testid="pending">loading</p>
{/if}
