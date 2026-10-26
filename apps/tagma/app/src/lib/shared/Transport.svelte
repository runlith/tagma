<script lang="ts" module>
  let touched: object | null = null;
</script>

<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import type { Snippet } from 'svelte';
  import { Host } from '@runlith/layer/Host';
  import { spellKey } from '$lib/shared/chordSpelling.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  type Props = {
    playing: boolean;
    time: string;
    toggle: () => void;
    step: (direction: -1 | 1) => void;
    disabled?: boolean;
    region?: HTMLElement | null;
    children?: Snippet;
  };

  let { playing, time, toggle, step, disabled = false, region = null, children }: Props = $props();

  const mine = {};
  const apple = Host.use().apple;

  let host = $state<HTMLElement | null>(null);

  const area = $derived(region ?? host?.closest('section') ?? host);

  const editable = (target: EventTarget | null): boolean =>
    target instanceof HTMLInputElement
      ? target.type !== 'range'
      : target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName));

  $effect(() => {
    touched ??= mine;
    return () => {
      if (touched === mine) touched = null;
    };
  });

  function keyed(event: KeyboardEvent): void {
    if (disabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
    const focused = document.activeElement;
    const inside = focused !== null && focused !== document.body;
    if (inside ? area?.contains(focused) !== true : touched !== mine) return;
    if (event.key === ' ') {
      if (!event.repeat) toggle();
    } else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window
  onkeydown={keyed}
  onpointerdown={(event) => {
    if (event.target instanceof Node && area?.contains(event.target) === true) touched = mine;
  }}
/>

<div bind:this={host} class="flex min-w-0 items-center gap-1.5">
  <Tooltip text={playing ? 'Pause' : 'Play'} keys={spellKey('Space', apple)}>
    <Button variant="ghost" size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} {disabled} onclick={toggle}>
      {#if playing}<Pause class="size-3.5" />{:else}<Play class="size-3.5" />{/if}
    </Button>
  </Tooltip>
  <span class="shrink-0 text-small tabular-nums text-muted-foreground">{time}</span>
  {@render children?.()}
</div>
