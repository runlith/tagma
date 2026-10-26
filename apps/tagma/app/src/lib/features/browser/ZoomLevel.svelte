<script lang="ts">
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ZOOM_KEYS } from './zoom.js';

  let { zoom, zoomTo }: { zoom: number; zoomTo: (factor: number) => void } = $props();

  const keymap = Keymap.use();
</script>

{#if zoom !== 1}
  <Tooltip text="Reset zoom" keys={keymap.spell(keymap.mod(ZOOM_KEYS.reset))}>
    <button
      type="button"
      class="h-7 shrink-0 rounded-md px-1 text-small text-muted-foreground tabular-nums hover:bg-hover"
      onclick={() => zoomTo(1)}
    >
      {Math.round(zoom * 100)}%
    </button>
  </Tooltip>
{/if}
