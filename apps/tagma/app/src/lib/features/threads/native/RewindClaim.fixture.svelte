<script lang="ts" module>
  import type { ChatRewind } from '@runlith/chat-ui/rewind';

  export type RewindWorld = {
    offered: boolean;
    port: ChatRewind;
    loads: number;
    readonly failures: unknown[];
    slow(loads: number): Promise<number>;
  };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { RenderingPorts } from './RenderingPorts.svelte.js';

  let { world, ports }: { world: RewindWorld; ports: RenderingPorts } = $props();

  $effect.pre(() => {
    if (!world.offered) {
      untrack(() => world.loads++);
      return;
    }
    const port = world.port;
    try {
      return ports.contributeRewind('rewind.composer.svelte', port);
    } catch (error) {
      world.failures.push(error);
    }
  });
</script>

<p>{await world.slow(world.loads)}</p>
