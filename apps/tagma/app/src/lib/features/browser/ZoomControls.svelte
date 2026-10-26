<script lang="ts">
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ZOOM_KEYS, zoomStep } from './zoom.js';
  import ZoomLevel from './ZoomLevel.svelte';

  let { zoom, zoomTo }: { zoom: number; zoomTo: (factor: number) => void } = $props();

  const keymap = Keymap.use();
</script>

<Tooltip text="Zoom out" keys={keymap.spell(keymap.mod(ZOOM_KEYS.out))}>
  <Button variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Zoom out" onclick={() => zoomTo(zoomStep(zoom, -1))}>
    <ZoomOut class="size-3.5" />
  </Button>
</Tooltip>
<ZoomLevel {zoom} {zoomTo} />
<Tooltip text="Zoom in" keys={keymap.spell(keymap.mod(ZOOM_KEYS.in))}>
  <Button variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Zoom in" onclick={() => zoomTo(zoomStep(zoom, 1))}>
    <ZoomIn class="size-3.5" />
  </Button>
</Tooltip>
