<script lang="ts">
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { ThreadSeats } from './seats/ThreadSeats.svelte.js';
  import { outputTab } from '$lib/features/executions/commands/outputTab.js';
  import type { ProcessLine } from '$lib/features/executions/processes/lines.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';

  let {
    line,
    projectId,
    worded = false,
    onOpen,
  }: { line: ProcessLine; projectId: number; worded?: boolean; onOpen?: () => void } = $props();

  const sides = SidePanes.use();
  const seats = ThreadSeats.use();
  const shell = shellActs(ShellOps.use(), Notices.use());

  async function open(): Promise<void> {
    onOpen?.();
    const content = outputTab(projectId, line.key);
    const thread = line.owner.thread;
    if (thread === null) {
      sides.open(content);
      return;
    }
    if (seats.standing(thread).kind === 'free') await shell.openThread({ projectId, threadId: thread }, 'main');
    const layouts = sides.layouts;
    if (layouts !== null) seats.openFor(layouts, thread, content);
  }
</script>

{#if worded}
  <Button variant="outline" size="xs" onclick={() => void open()}><PanelRight class="size-3" />Open output</Button>
{:else}
  <Tooltip text="Open its output as a terminal tab beside">
    <Button variant="ghost" size="icon-xs" class="size-6" aria-label="Open its output as a terminal tab" onclick={() => void open()}>
      <PanelRight class="size-3" />
    </Button>
  </Tooltip>
{/if}
