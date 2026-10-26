<script lang="ts">
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import ViewTab from '$lib/shared/ui/ViewTab.svelte';
  import { COLUMN_VIEWS, Column, type ColumnView } from './Column.svelte.js';

  const column = Column.use();
  const keymap = Keymap.use();

  const LABEL: Record<ColumnView, string> = { files: 'Files', search: 'Search', git: 'Git' };
  const CODE: Record<ColumnView, string> = { files: 'KeyE', search: 'KeyF', git: 'KeyG' };

  let { changes = 0 }: { changes?: number } = $props();
</script>

<div class="flex h-8 shrink-0 items-center gap-1 border-b px-1" role="tablist" aria-label="Checkout" data-column-tabs>
  {#each COLUMN_VIEWS as view (view)}
    <Tooltip text={LABEL[view]} keys={keymap.spell(keymap.mod(CODE[view], { shift: true }))}>
      <ViewTab selected={column.view === view} onclick={() => column.show(view)} data-column-tab={view}>
        {LABEL[view]}
        {#if view === 'git' && changes > 0}
          <span class="font-mono text-meta tabular-nums text-muted-foreground" data-column-changes>{changes}</span>
        {/if}
      </ViewTab>
    </Tooltip>
  {/each}
</div>
