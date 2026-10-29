<script lang="ts">
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import TagmaAppView from './TagmaAppView.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  let { tagmaApp, view }: { tagmaApp: string; view: string } = $props();

  const projectId = ProjectRung.Current.use().projectId;
  const sets = ViewSets.use();
  const section = $derived(sets.surface(tagmaApp, view));
</script>

<div class="h-full min-h-0" data-tagma-app={tagmaApp} data-view={view}>
  {#if section !== undefined}
    {#key `${tagmaApp}/${view}`}
      <TagmaAppView {tagmaApp} {view} {projectId} threadId={null} fill />
    {/key}
  {:else if sets.problem !== null}
    <p class="px-4 py-3 text-small text-chat-failure/90">{sets.problem}</p>
  {:else if sets.known}
    <p class="px-4 py-3 text-small text-muted-foreground">
      {sets.enabled.includes(tagmaApp) && !sets.sets.some((set) => set.app === tagmaApp)
        ? `The app ${tagmaApp} is starting or not running.`
        : `This project has no section ${tagmaApp}/${view}.`}
    </p>
  {/if}
</div>
