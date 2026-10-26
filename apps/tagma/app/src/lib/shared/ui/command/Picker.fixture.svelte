<script lang="ts">
  import * as Command from './index.js';

  let {
    labels,
    searchable = true,
    value = $bindable(),
    picked,
  }: { labels: readonly string[]; searchable?: boolean; value?: string; picked: (label: string) => void } = $props();
</script>

<Command.Root bind:value>
  {#if searchable}
    <Command.Input placeholder="Find…" />
  {/if}
  <Command.List>
    {#each labels as label (label)}
      <Command.Item value={label} data-item={label} onSelect={() => picked(label)}>{label}</Command.Item>
    {/each}
  </Command.List>
  <button data-foreign>Elsewhere</button>
</Command.Root>
