<script lang="ts">
  import { Collection, type Highlighting } from '../collection.svelte.js';

  interface Entry {
    readonly label: string;
    readonly disabled?: boolean;
  }

  let {
    highlighting,
    loop = false,
    entries,
    picked,
  }: { highlighting: Highlighting; loop?: boolean; entries: readonly Entry[]; picked: (label: string) => void } = $props();

  const collection = new Collection(() => ({ highlighting, loop }));
</script>

{#snippet options(role: string)}
  {#each entries as entry (entry.label)}
    <div
      {role}
      data-item={entry.label}
      {@attach collection.item(() => ({ value: entry.label, disabled: entry.disabled, onSelect: () => picked(entry.label) }))}
    >
      {entry.label}
    </div>
  {/each}
  <button data-foreign>other</button>
{/snippet}

{#if highlighting === 'focus'}
  <div role="menu" data-field {@attach collection.field}>
    {@render options('menuitem')}
  </div>
{:else}
  <input data-field {@attach collection.field} />
  <div role="listbox">
    {@render options('option')}
  </div>
{/if}
