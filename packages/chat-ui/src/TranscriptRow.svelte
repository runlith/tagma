<script lang="ts">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import { type Snippet, untrack } from 'svelte';

  type Props = {
    rowKey: string;
    place: string;
    top: number;
    size: number;
    ready: boolean;
    spaced: boolean;
    dim?: boolean;
    inert?: boolean;
    measure(node: HTMLElement): void;
    children: Snippet;
  };

  let { rowKey, place, top, size, ready, spaced, dim = false, inert = false, measure, children }: Props = $props();
  const floor = untrack(() => size);

  let node: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (node) measure(node);
  });
</script>

<div class="absolute left-0 w-full overflow-clip" style={`top:${top}px;height:${size}px;overflow-clip-margin:0.5px`}>
  <div
    bind:this={node}
    data-timeline-key={rowKey}
    {@attach (row) => row.toggleAttribute('inert', inert)}
    class={['w-full', spaced && 'pb-3 @min-[34rem]:pb-4', dim && 'opacity-45']}
    style={ready ? undefined : `min-height:${floor}px`}
  >
    <ErrorBoundary id={place}>
      {@render children()}
    </ErrorBoundary>
  </div>
</div>
