<script lang="ts">
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import ToolRow from '@runlith/chat-ui/entries/ToolRow.svelte';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import NoOutput from '$lib/features/executions/commands/NoOutput.svelte';
  import type { ProcessLine } from '$lib/features/executions/processes/lines.js';
  import TerminalView from '$lib/features/executions/terminal/View.svelte';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';

  let { entry, line, view }: { entry: ChatEntryOf<'tool'>; line: ProcessLine | null; view: CommandView | null } = $props();

  const projectId = ProjectRung.Current.use().projectId;
</script>

<div class="grid min-w-0 gap-2">
  <ToolRow {entry} />
  {#if line !== null && view !== null && line.transport === 'pipes'}
    {#if line.printed !== false}
      <TerminalView
        class="h-44 overflow-hidden rounded-lg border border-vein"
        key={line.key}
        {projectId}
        address={line.address}
        program={line.label ?? line.command ?? 'command'}
        source={{ _tag: 'Output', record: line.kind }}
        cwd={line.cwd}
      />
    {:else}
      <NoOutput {line} class="rounded-lg border border-vein" />
    {/if}
  {/if}
</div>
