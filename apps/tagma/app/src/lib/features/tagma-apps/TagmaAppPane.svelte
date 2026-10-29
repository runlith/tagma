<script lang="ts">
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { paneOf } from './panes.js';
  import TagmaAppView from './TagmaAppView.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const projectId = ProjectRung.Current.use().projectId;
  const sets = ViewSets.use();
  const target = $derived(paneOf(pane.id));
  const shown = $derived(target === null ? undefined : sets.pane(target.tagmaApp, target.view));
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label={shown?.title ?? 'App pane'}>
  <div class="min-h-0 min-w-0 flex-1" data-tagma-app={target?.tagmaApp} data-view={target?.view}>
    {#if target !== null && shown !== undefined}
      {#key pane.id}
        <TagmaAppView tagmaApp={target.tagmaApp} view={target.view} {projectId} threadId={null} fill />
      {/key}
    {:else if sets.known}
      <p class="px-3 py-2 text-small text-muted-foreground">This project has no pane {pane.id}.</p>
    {/if}
  </div>
</section>
