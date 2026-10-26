<script lang="ts">
  import { untrack } from 'svelte';

  import { Float } from '../float.svelte.js';
  import { OverlayLayer } from '../layer.svelte.js';
  import Portal from '../Portal.svelte';

  let open = $state(false);
  let anchor = $state<HTMLElement | null>(null);

  const layer = OverlayLayer.make((reason) => {
    layer.close(reason);
    open = false;
  });
  const float = Float.make(
    layer,
    () => anchor ?? undefined,
    () => ({ side: 'bottom', align: 'start', sideOffset: 4 }),
  );

  $effect.pre(() => {
    if (open) untrack(() => layer.open());
    else untrack(() => layer.close());
  });
</script>

<button data-anchor bind:this={anchor} {@attach layer.trigger} onclick={() => (open = !open)}>open</button>
{#if open}
  <Portal>
    <div data-float style={float.style} data-side={float.side} {@attach layer.surface} {@attach float.floating}></div>
  </Portal>
{/if}
