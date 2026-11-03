<script lang="ts">
  import { terminalKey, type ExecutionAddress } from '$lib/features/executions/Repo.js';
  import { SHELL } from '$lib/features/executions/terminal/Pane.svelte.js';
  import TerminalView from '$lib/features/executions/terminal/View.svelte';

  let { execution, projectId, program }: { execution: ExecutionAddress; projectId: number; program: string } = $props();
</script>

{#key terminalKey(execution)}
  <TerminalView
    class="h-64 rounded-md border border-vein"
    key={terminalKey(execution)}
    {projectId}
    address={execution}
    {program}
    source={SHELL}
  />
{/key}
