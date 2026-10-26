<script lang="ts">
  import { untrack } from 'svelte';

  import { OverlayLayer, type DismissReason } from '../layer.svelte.js';
  import Portal from '../Portal.svelte';
  import Probe from './Probe.svelte';

  let {
    name,
    open = $bindable(false),
    inner,
    innerTraps,
    declines = [],
    modal = false,
    traps,
  }: {
    name: string;
    open?: boolean;
    inner?: string;
    innerTraps?: boolean;
    declines?: readonly DismissReason[];
    modal?: boolean;
    traps?: boolean;
  } = $props();

  const layer = OverlayLayer.make(
    (reason) => {
      if (declines.includes(reason)) return;
      layer.close(reason);
      open = false;
    },
    { modal: untrack(() => modal), trapFocus: () => traps },
  );

  $effect.pre(() => {
    if (open) untrack(() => layer.open());
    else untrack(() => layer.close());
  });
</script>

<button data-trigger={name} {@attach layer.trigger} onclick={() => (open = !open)}>{name}</button>
{#if open}
  <Portal>
    <div data-layer={name} style:z-index={layer.z} {@attach layer.surface}>
      <input data-field={name} />
      {#if inner !== undefined}
        <Probe name={inner} traps={innerTraps} />
      {/if}
    </div>
  </Portal>
{/if}
