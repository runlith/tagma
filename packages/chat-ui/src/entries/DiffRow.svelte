<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    index,
    top,
    class: styling,
    measure,
    wrap = false,
    children,
  }: {
    index: number;
    top: number;
    class: string;
    measure(node: HTMLElement): void;
    wrap?: boolean;
    children: Snippet;
  } = $props();

  let node: HTMLDivElement | undefined = $state();

  $effect(() => {
    index;
    wrap;
    if (node) measure(node);
  });
</script>

<div bind:this={node} data-index={index} class={['absolute left-0 w-full', !wrap && 'min-w-max', styling]} style={`top:${top}px`}>
  {@render children()}
</div>
