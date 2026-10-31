<script lang="ts">
  import PanelBottom from '@lucide/svelte/icons/panel-bottom';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';

  let { onOpen }: { onOpen: () => void } = $props();
</script>

<Tooltip text="Open its terminal">
  <Button variant="ghost" size="icon-xs" class="size-6" aria-label="Open its terminal" onclick={onOpen}>
    <PanelBottom class="size-3" />
  </Button>
</Tooltip>
