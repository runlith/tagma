<script lang="ts">
  import { untrack } from 'svelte';
  import type { Seam } from './Seam.svelte.js';

  type Props = {
    seam: Seam;
    label: string;
    contained?: boolean;
    line?: number;
  };

  let { seam, label, contained = false, line }: Props = $props();

  let handle = $state<HTMLButtonElement | null>(null);
  let pointed = $state(false);
  const grip = {};

  const thickness = $derived(line ?? 1);

  $effect(() => {
    untrack(() => seam.measure());
    return () => seam.dispose(grip);
  });

  $effect(() => {
    if (pointed) return seam.point();
  });

  $effect(() => {
    const row = handle?.parentElement;
    const gap = line ?? 0;
    if (contained && row) return untrack(() => seam.contain(row, gap));
  });
</script>

<svelte:window onresize={() => seam.measure()} />

<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
<button
  bind:this={handle}
  type="button"
  class="seam"
  class:dragging={seam.dragging}
  class:collapsing={seam.willCollapse}
  class:lit={seam.hovered}
  class:standing={line !== undefined}
  style:--seam-thickness="{thickness}px"
  data-axis={seam.axis}
  data-side={seam.side}
  role="separator"
  aria-label={label}
  aria-orientation={seam.axis === 'x' ? 'vertical' : 'horizontal'}
  aria-valuenow={seam.size}
  aria-valuemin={seam.min}
  aria-valuemax={seam.max}
  onpointerenter={() => (pointed = true)}
  onpointerleave={() => (pointed = false)}
  onpointerdown={(event) => seam.grab(event, grip)}
  onkeydown={(event) => seam.key(event)}
  ondblclick={() => seam.reset()}
></button>

<style>
  .seam {
    position: relative;
    z-index: 20;
    display: block;
    flex: 0 0 auto;
    align-self: stretch;
    justify-self: stretch;
    touch-action: none;
    appearance: none;
    padding: 0;
    border: 0;
    background: transparent;
    outline: none;
    -webkit-app-region: no-drag;
  }

  .seam[data-axis='x'] {
    width: calc(var(--seam-thickness) + 8px);
    margin-inline: calc(-4px - var(--seam-thickness)) -4px;
    cursor: col-resize;
  }

  .seam[data-axis='y'] {
    height: calc(var(--seam-thickness) + 8px);
    margin-block: calc(-4px - var(--seam-thickness)) -4px;
    cursor: row-resize;
  }

  .seam[data-axis='x'][data-side='start'] {
    margin-inline: -4px calc(-4px - var(--seam-thickness));
  }

  .seam[data-axis='y'][data-side='start'] {
    margin-block: -4px calc(-4px - var(--seam-thickness));
  }

  .seam.standing[data-axis='x'] {
    margin-inline: -4px;
  }

  .seam.standing[data-axis='y'] {
    margin-block: -4px;
  }

  .seam::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    background: var(--seam-line, var(--foreground, currentColor));
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .seam[data-axis='x']::after {
    width: 2px;
    height: 100%;
  }

  .seam[data-axis='y']::after {
    height: 2px;
    width: 100%;
  }

  .seam.lit::after {
    opacity: 0.3;
  }

  .seam.dragging::after {
    opacity: 0.5;
  }

  .seam.standing::after {
    opacity: 1;
  }

  .seam.standing[data-axis='x']::after {
    width: var(--seam-thickness);
  }

  .seam.standing[data-axis='y']::after {
    height: var(--seam-thickness);
  }

  .seam.standing.lit::after,
  .seam.standing.dragging::after {
    background: var(--seam-line-active, var(--seam-line, var(--foreground, currentColor)));
  }

  .seam:focus-visible::after {
    background: var(--ring, currentColor);
    opacity: 1;
  }

  .seam.collapsing::after {
    background: var(--destructive, currentColor);
    opacity: 0.9;
  }
</style>
