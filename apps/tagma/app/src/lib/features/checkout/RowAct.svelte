<script lang="ts">
  import type { Component } from 'svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { label, icon: Icon, onclick }: { label: string; icon: Component<{ class?: string }>; onclick: () => void } = $props();
</script>

<Tooltip text={label}>
  <button
    type="button"
    class="grid size-5 place-items-center rounded-sm bg-hover text-muted-foreground transition-colors hover:bg-selected hover:text-foreground"
    aria-label={label}
    onclick={(event) => {
      event.stopPropagation();
      onclick();
    }}
  >
    <Icon class="size-3.5" />
  </button>
</Tooltip>
