<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    index,
    rowKey,
    class: styling,
    measure,
    wrap = false,
    children,
  }: {
    index: number;
    rowKey: string;
    class: string;
    measure(node: HTMLElement, key: string): () => void;
    wrap?: boolean;
    children: Snippet;
  } = $props();

  let node: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (node) return measure(node, rowKey);
  });
</script>

<div bind:this={node} data-index={index} class={['absolute left-0 w-full', !wrap && 'min-w-max', styling]}>
  {@render children()}
</div>
