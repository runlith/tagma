<script lang="ts">
  import type { McpServerRowStatus } from '@tagma/server/mcp/contract/wire/servers';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { status }: { status: McpServerRowStatus } = $props();

  const TONE: Record<McpServerRowStatus, string> = {
    connected: 'bg-status-done',
    connecting: 'bg-status-in-work',
    pending: 'bg-vein-strong',
    'needs-value': 'bg-status-open',
    'needs-sign-in': 'bg-status-open',
    failed: 'bg-severity-lie',
    disabled: 'bg-status-closed',
  };
</script>

<Tooltip text={status}>
  <span class="size-2 shrink-0 {TONE[status]}"></span>
</Tooltip>
