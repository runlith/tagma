<script lang="ts">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import type { Snippet } from 'svelte';

  type Props = {
    rowKey: string;
    place: string;
    spaced: boolean;
    dim?: boolean;
    inert?: boolean;
    box(key: string, node: HTMLElement): () => void;
    measure(node: HTMLElement): void;
    children: Snippet;
  };

  let { rowKey, place, spaced, dim = false, inert = false, box, measure, children }: Props = $props();

  let node: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (node) measure(node);
  });
</script>

<div class="absolute top-0 left-0 w-full overflow-clip" style="overflow-clip-margin:0.5px" {@attach (outer) => box(rowKey, outer)}>
  <div
    bind:this={node}
    data-timeline-key={rowKey}
    {@attach (row) => row.toggleAttribute('inert', inert)}
    class={['w-full', spaced && 'pb-3 @min-[34rem]:pb-4', dim && 'opacity-45']}
  >
    <ErrorBoundary id={place}>
      {@render children()}
    </ErrorBoundary>
  </div>
</div>
