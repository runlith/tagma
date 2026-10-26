<script lang="ts">
  import { Float } from '@runlith/primitives/float.svelte';
  import { OverlayLayer } from '@runlith/primitives/layer.svelte';
  import Portal from '@runlith/primitives/Portal.svelte';
  import { tooltip } from '@runlith/primitives/tooltip.svelte';
  import { untrack } from 'svelte';
  import { emerge } from '../emerge.js';
  import Kbd from '../kbd/Kbd.svelte';

  const layer = OverlayLayer.make(
    (reason) => {
      if (reason === 'detached') tooltip.hide();
    },
    { dismissable: false, returnFocus: () => false },
  );
  const float = Float.make(
    layer,
    () => tooltip.anchor,
    () => ({ side: tooltip.side, sideOffset: 8 }),
  );

  $effect.pre(() => {
    if (tooltip.text) untrack(() => layer.open());
    else untrack(() => layer.close());
  });
</script>

<Portal>
  {#if tooltip.text}
    <div
      role="tooltip"
      class="pointer-events-none max-w-xs origin-(--float-origin) rounded-md border border-border bg-popover px-2 py-1 text-small whitespace-pre-line text-popover-foreground shadow-raised"
      style={float.style}
      data-side={float.side}
      transition:emerge={float}
      {@attach layer.surface}
      {@attach float.floating}
    >
      {#if tooltip.keys === undefined}
        {tooltip.text}
      {:else}
        <span class="flex items-center gap-2">{tooltip.text}<Kbd chord={tooltip.keys} size="sm" /></span>
      {/if}
      {#each tooltip.hints as hint (hint.keys)}
        <span class="mt-1 flex items-center gap-1.5 text-muted-foreground"><Kbd chord={hint.keys} size="sm" />{hint.words}</span>
      {/each}
      <span class="absolute top-0 left-0 -z-1 [translate:var(--float-origin)]">
        <span class="block size-2.5 -translate-1/2 rotate-45 rounded-sm bg-popover"></span>
      </span>
    </div>
  {/if}
</Portal>
