<script lang="ts">
  import type { VirtualAnchor } from '@runlith/primitives/float.svelte';
  import type { Side } from '@runlith/primitives/place';
  import { tooltip, type TooltipHint } from '@runlith/primitives/tooltip.svelte';
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let {
    text,
    keys,
    hints,
    side,
    delayMs,
    class: className,
    style,
    children,
  }: {
    text?: string | null;
    keys?: string | null;
    hints?: readonly TooltipHint[];
    side?: Side;
    delayMs?: number;
    class?: ClassValue;
    style?: string;
    children: Snippet;
  } = $props();

  const wrapClass = $derived(cn(className));
  const boxed = $derived(wrapClass !== '');

  let wrap = $state<HTMLElement | null>(null);

  const anchor = $derived(boxed || wrap === null ? undefined : contents(wrap));

  function contents(at: HTMLElement): VirtualAnchor {
    return {
      rect: () => {
        const child = at.firstElementChild;
        if (child !== null) return child.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(at);
        return range.getBoundingClientRect();
      },
      get element() {
        return at.firstElementChild ?? at.parentElement ?? at;
      },
    };
  }
</script>

<span
  bind:this={wrap}
  class={boxed ? wrapClass : 'contents'}
  {style}
  {@attach tooltip.trigger(() => ({ text, keys, hints, side, delayMs, anchor }))}>{@render children()}</span
>
