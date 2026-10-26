<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import DragGhost from '$lib/shared/DragGhost.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import FolderRemove from './FolderRemove.svelte';
  import { ThreadList } from './List.svelte.js';
  import type { Shelving } from './shelving.svelte.js';
  import { filedIn } from './tree.js';

  let { shelving, part }: { shelving: Shelving; part: 'bar' | 'floating' } = $props();

  const list = ThreadList.use();
  const drag = $derived(shelving.drag);
  const counts = $derived.by(() => {
    const filed = new Map<string, number>(list.folders.map((folder) => [folder.id, 0]));
    for (const node of list.tree) {
      const folderId = filedIn(node, list.folders);
      if (folderId !== null) filed.set(folderId, (filed.get(folderId) ?? 0) + 1);
    }
    return filed;
  });

  let bar = $state<HTMLDivElement | null>(null);
  const BUTTON = 'rounded-md px-2 py-0.5 opacity-80 hover:opacity-100';
</script>

{#if part === 'bar'}
  {#if shelving.selection.size > 1}
    <div
      bind:this={bar}
      class="mx-1.5 mb-1.5 flex shrink-0 items-center gap-0.5 rounded-lg bg-foreground py-1 pr-1 pl-3 text-small text-background"
      data-thread-selection
    >
      <span class="min-w-0 flex-1 truncate font-medium">{shelving.selection.size} selected</span>
      <button
        type="button"
        class={BUTTON}
        onclick={() => bar !== null && (shelving.picking = { ids: [...shelving.selection], anchor: bar })}>Move…</button
      >
      <button type="button" class={BUTTON} onclick={() => void shelving.drop([...shelving.selection], { kind: 'archive' })}>Archive</button>
      <button
        type="button"
        class="grid size-5 place-items-center rounded-md opacity-80 hover:opacity-100"
        aria-label="Clear the selection"
        onclick={() => (shelving.selection = new Set())}
      >
        <X class="size-3" />
      </button>
    </div>
  {/if}
{:else}
  {#if drag.carried !== null}
    <DragGhost
      x={drag.x}
      y={drag.y}
      label={drag.carried.label}
      target={drag.carried.kind === 'folder' || drag.target === null ? null : shelving.arrivesAt(drag.target)}
      faded={drag.carried.kind !== 'folder' && drag.target === null}
    />
  {/if}
  <FolderRemove {shelving} />
  {#if shelving.picking !== null}
    {@const ids = shelving.picking.ids}
    <FolderPicker
      folders={list.folders}
      {counts}
      here={shelving.placeOf(ids)}
      count={ids.length}
      anchor={shelving.picking.anchor}
      onPick={(choice) => shelving.pick(ids, choice)}
      onClose={() => (shelving.picking = null)}
    />
  {/if}
{/if}
