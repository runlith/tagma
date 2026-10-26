<script lang="ts">
  import PanelBottom from '@lucide/svelte/icons/panel-bottom';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';

  let { terminalKey, onOpen }: { terminalKey: string; onOpen: () => void } = $props();

  const terminals = Terminals.use();
</script>

<Tooltip text="Open in the terminal panel">
  <Button
    variant="ghost"
    size="icon-xs"
    class="size-6"
    aria-label="Open in the terminal panel"
    onclick={() => {
      onOpen();
      void terminals.reveal(terminalKey);
    }}
  >
    <PanelBottom class="size-3" />
  </Button>
</Tooltip>
