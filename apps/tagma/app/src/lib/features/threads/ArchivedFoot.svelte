<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import type { Snippet } from 'svelte';
  import { ArchivedThreadsOpen } from './ArchivedThreadsOpen.svelte.js';
  import type { ColumnDrag } from './drag.svelte.js';
  import { ThreadList } from './List.svelte.js';
  import type { ColumnLine } from './columnLines.js';

  let {
    lines,
    drag,
    draw,
  }: {
    lines: readonly ColumnLine[];
    drag: ColumnDrag;
    draw: Snippet<[ColumnLine]>;
  } = $props();

  const archived = ArchivedThreadsOpen.use();
  const list = ThreadList.use();
  const docked = $derived(drag.carried?.kind === 'trees');

  const ZONE = 'flex h-[34px] items-center justify-center gap-1.5 rounded-lg border-[1.5px] text-small transition-colors';
</script>

<div class="flex min-h-0 max-h-[40%] shrink-0 flex-col border-t py-1">
  {#if docked}
    <div class="mx-1.5 grid grid-cols-2 gap-1.5 py-1" data-drag-dock>
      <div
        class={[
          ZONE,
          drag.aims({ kind: 'new' })
            ? 'border-status-open bg-status-open/10 text-status-open'
            : 'border-dashed border-foreground/20 text-muted-foreground',
        ]}
        data-drop="new"
      >
        <FolderPlus class="size-3.5" />New folder
      </div>
      <div
        class={[
          ZONE,
          drag.aims({ kind: 'archive' })
            ? 'border-status-open bg-status-open/10 text-status-open'
            : 'border-dashed border-foreground/20 text-muted-foreground',
        ]}
        data-drop="archive"
      >
        <Archive class="size-3.5" />Archive
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="mx-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-small text-muted-foreground hover:bg-hover hover:text-foreground"
      aria-expanded={archived.open}
      onclick={() => archived.toggle()}
    >
      <ChevronRight class={['size-3.5 transition-transform', archived.open ? 'rotate-90' : '']} />
      <span class="eyebrow">Archived</span>
      {#if list.archivedTotal !== null}
        <span class="tabular ml-auto">{list.archivedTotal}</span>
      {/if}
    </button>
    {#if archived.open}
      <div class="grid min-h-0 flex-1 content-start gap-px overflow-y-auto px-1.5">
        {#if list.archived !== null && list.archived.length === 0}
          <p class="px-2 py-1 text-small text-muted-foreground">Nothing put away.</p>
        {/if}
        {#each lines as line (line.key)}
          {@render draw(line)}
        {/each}
        {#if list.archived !== null && list.archivedTotal !== null && list.archivedTotal > list.archived.length}
          <p class="px-2 py-1 text-small text-muted-foreground">
            The newest {list.archived.length} of {list.archivedTotal}.
          </p>
        {/if}
      </div>
    {/if}
  {/if}
</div>
