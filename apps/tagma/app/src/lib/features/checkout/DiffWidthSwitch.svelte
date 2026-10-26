<script lang="ts">
  import FoldVertical from '@lucide/svelte/icons/fold-vertical';
  import UnfoldVertical from '@lucide/svelte/icons/unfold-vertical';
  import { Button } from '$lib/shared/ui/button/index.js';
  import type { DiffWidth } from './diffWidth.js';

  let {
    width,
    tooWide = false,
    said = null,
    onWidth,
  }: {
    width: DiffWidth;
    tooWide?: boolean;
    said?: string | null;
    onWidth: (next: DiffWidth) => void;
  } = $props();

  const whole = $derived(width === 'whole');
  const title = $derived(
    tooWide
      ? (said ?? 'This file is longer than one reading carries whole.')
      : whole
        ? 'Whole file — press for the changes alone'
        : 'Changes alone — press for the whole file',
  );
</script>

<Button
  size="icon-sm"
  variant="ghost"
  class="size-6 shrink-0"
  aria-pressed={whole}
  aria-label={whole ? 'Show the changes alone' : 'Show the whole file'}
  {title}
  disabled={tooWide}
  data-diff-width={whole ? 'whole' : 'patch'}
  onclick={() => onWidth(whole ? 'patch' : 'whole')}
>
  {#if whole}
    <FoldVertical class="size-3.5" />
  {:else}
    <UnfoldVertical class="size-3.5" />
  {/if}
</Button>
