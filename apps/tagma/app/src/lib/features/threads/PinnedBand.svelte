<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { ThreadList } from './List.svelte.js';
  import type { ThreadTreeNode } from './forest.js';

  let {
    count,
    open,
    aimed,
    quiet,
    onToggle,
  }: { count: number; open: boolean; aimed: boolean; quiet: readonly ThreadTreeNode[]; onToggle: () => void } = $props();

  const list = ThreadList.use();

  let unpinning = $state(false);
  async function unpinQuiet(): Promise<void> {
    unpinning = true;
    try {
      await Promise.all(quiet.map((node) => list.setPinned(node.row.id, false)));
    } finally {
      unpinning = false;
    }
  }
</script>

<div
  class={[
    'group/band mt-0.5 flex items-center gap-1.5 rounded-md pr-2 text-small text-muted-foreground',
    aimed && 'bg-status-open/12 text-status-open outline-1 -outline-offset-1 outline-status-open/50',
  ]}
  data-drop="pinned"
>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-1.5 text-left hover:text-foreground"
    aria-expanded={open}
    aria-label={open ? 'Collapse the pinned band' : 'Expand the pinned band'}
    onclick={onToggle}
  >
    <ChevronRight class={['size-3.5 shrink-0 transition-transform', open ? 'rotate-90' : '']} />
    <span class="eyebrow">Pinned</span>
  </button>
  {#if quiet.length > 0}
    <button
      type="button"
      class="shrink-0 rounded-sm px-1 py-0.5 opacity-0 transition-opacity duration-150 ease-instrument hover:text-foreground focus-visible:opacity-100 group-hover/band:opacity-100"
      disabled={unpinning}
      onclick={() => void unpinQuiet()}
    >
      Unpin quiet
    </button>
  {/if}
  <span class="tabular shrink-0">{count}</span>
</div>
