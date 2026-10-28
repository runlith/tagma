<script lang="ts">
  import { Engine, SecondEngine, World } from './fixtures.svelte.js';

  let { second = false }: { second?: boolean } = $props();

  const world = World.use();
  world.a = 1;
  const engine = await Engine.use();
  if (second) {
    world.c = 3;
    await SecondEngine.use();
  }
</script>

<p data-testid="found">{engine.find('book')}</p>
