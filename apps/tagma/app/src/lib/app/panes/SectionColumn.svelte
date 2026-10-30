<script lang="ts">
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { type Snippet, untrack } from 'svelte';
  import type { SeamGeometry } from '$lib/shared/seams/Seams.svelte.js';
  import { AreaFrame } from './AreaFrame.svelte.js';

  let {
    geometry,
    label,
    resize,
    onCollapse,
    element = $bindable(null),
    class: className = '',
    children,
  }: {
    geometry: SeamGeometry;
    label: string;
    resize: string;
    onCollapse: () => void;
    element?: HTMLElement | null;
    class?: string;
    children: Snippet;
  } = $props();

  const frame = AreaFrame.use();
  const seam = frame.columnSeam(
    untrack(() => geometry),
    () => onCollapse(),
  );
  $effect(() => frame.show('column', seam));
</script>

<aside bind:this={element} class={['flex shrink-0 flex-col border-r bg-chrome', className]} style:width="{seam.size}px" aria-label={label}>
  {@render children()}
</aside>

<SeamHandle {seam} label={resize} />
