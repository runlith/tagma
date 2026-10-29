<script lang="ts">
  import type { ChatEntryContext } from './renderers';
  import type { ChatPin, ChatPinBounds } from './surface';

  type Props = {
    pins: readonly ChatPin[];
    context: ChatEntryContext;
  };

  let { pins, context }: Props = $props();

  const SHARE = 1 / 3;

  let host: HTMLDivElement | undefined = $state();
  let limit = $state<number | null>(null);

  const bounds: ChatPinBounds = {
    get maxHeight() {
      return limit;
    },
  };

  $effect(() => {
    const element = host;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const parent = element.parentElement;
    const measure = () => {
      if (parent !== null) limit = Math.floor(parent.clientHeight * SHARE);
    };
    measure();
    const outer = new ResizeObserver(measure);
    if (parent !== null) outer.observe(parent);
    return () => outer.disconnect();
  });
</script>

{#if pins.length > 0}
  <div
    bind:this={host}
    class="relative z-10 shrink-0 overflow-y-auto border-b border-border bg-background"
    style:max-height={limit === null ? undefined : `${limit}px`}
    data-pinned-region=""
  >
    {#each pins as pin (pin.id)}
      {@render pin.body(context, bounds)}
    {/each}
  </div>
{/if}
