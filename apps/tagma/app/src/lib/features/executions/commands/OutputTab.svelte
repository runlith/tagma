<script lang="ts">
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import TerminalView from '../terminal/View.svelte';
  import { CommandActivity } from './Activity.svelte.js';
  import { outputTabOf } from './outputTab.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const activity = CommandActivity.use();
  const tab = $derived(outputTabOf(pane.id));
  const line = $derived(tab === null ? null : activity.line(tab.key));
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Command output">
  {#if tab !== null}
    {#key tab.key}
      <TerminalView
        class="min-h-0 flex-1"
        key={`tab:${tab.key}`}
        projectId={tab.projectId}
        address={tab.address}
        program={line?.label ?? line?.command ?? 'command'}
        source={{ _tag: 'Output', record: 'command' }}
        cwd={line?.cwd ?? null}
      />
    {/key}
  {/if}
</section>
