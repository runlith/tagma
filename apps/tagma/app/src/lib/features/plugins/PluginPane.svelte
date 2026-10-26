<script lang="ts">
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { pluginPaneOf } from './panes.js';
  import PluginView from './PluginView.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const projectId = ProjectRung.Current.use().projectId;
  const sets = ViewSets.use();
  const target = $derived(pluginPaneOf(pane.id));
  const shown = $derived(target === null ? undefined : sets.pane(target.plugin, target.view));
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label={shown?.title ?? 'Plugin pane'}>
  <div class="min-h-0 min-w-0 flex-1" data-plugin={target?.plugin} data-view={target?.view}>
    {#if target !== null && shown !== undefined}
      {#key pane.id}
        <PluginView plugin={target.plugin} view={target.view} {projectId} threadId={null} fill />
      {/key}
    {:else if sets.known}
      <p class="px-3 py-2 text-small text-muted-foreground">This project has no pane {pane.id}.</p>
    {/if}
  </div>
</section>
