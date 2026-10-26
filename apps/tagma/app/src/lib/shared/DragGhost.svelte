<script lang="ts">
  import FadeText from './FadeText.svelte';

  let {
    x,
    y,
    label,
    target,
    faded = target === null,
  }: { x: number; y: number; label: string; target: string | null; faded?: boolean } = $props();
</script>

<div
  class={[
    'pointer-events-none fixed top-0 left-0 z-50 flex max-w-72 items-center gap-2 rounded-lg border bg-popover px-3 py-1 text-ui text-popover-foreground shadow-raised',
    faded && 'opacity-80',
  ]}
  style:transform="translate({x + 14}px, {y + 12}px)"
  data-drag-ghost
>
  <FadeText text={label} />
  {#if target !== null}
    <span class="shrink-0 font-mono text-meta text-status-open">→ {target}</span>
  {/if}
</div>
