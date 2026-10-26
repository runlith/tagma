<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  let {
    fold,
    parentId,
    depth,
    count,
    expanded,
    through,
    onToggle,
  }: {
    fold: 'more-working' | 'finished';
    parentId: string;
    depth: number;
    count: number;
    expanded: boolean;
    through: boolean;
    onToggle: () => void;
  } = $props();

  const BASE_REM = 0.375;
  const INDENT_REM = 0.75;
  const GUTTER_REM = 0.875;

  const words = $derived(fold === 'finished' ? `${count} finished` : `${count} more working`);
  const ink = $derived(fold === 'finished' ? 'text-muted-foreground' : 'text-status-in-work/80');
</script>

<div class="group relative min-w-0">
  {#if through}
    <span
      class="pointer-events-none absolute -top-px bottom-0 w-px bg-vein group-hover:opacity-0 group-has-[:focus-visible]:opacity-0"
      style={`left: ${BASE_REM + depth * INDENT_REM + GUTTER_REM / 2}rem`}
    ></span>
  {/if}
  <button
    type="button"
    class={[
      'grid w-full grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-1.5 rounded-md py-1 pr-2 text-left text-small leading-4 hover:bg-hover focus-visible:bg-selected focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring',
      ink,
    ]}
    style={`padding-left: ${BASE_REM + (depth + 1) * INDENT_REM}rem`}
    aria-expanded={expanded}
    data-fold={fold}
    data-parent={parentId}
    onclick={onToggle}
  >
    <span class="grid size-3.5 place-items-center opacity-60">
      <ChevronRight class={['size-3 transition-transform', expanded ? 'rotate-90' : '']} />
    </span>
    <span class="truncate tabular">{words}</span>
  </button>
</div>
