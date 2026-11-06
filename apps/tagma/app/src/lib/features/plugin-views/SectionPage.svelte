<script lang="ts">
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import PluginView from './PluginView.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  let { plugin, view }: { plugin: string; view: string } = $props();

  const projectId = ProjectRung.Current.use().projectId;
  const sets = ViewSets.use();
  const section = $derived(sets.surface(plugin, view));
</script>

<div class="h-full min-h-0" data-plugin={plugin} data-view={view}>
  {#if section !== undefined}
    {#key `${plugin}/${view}`}
      <PluginView {plugin} {view} {projectId} threadId={null} fill />
    {/key}
  {:else if sets.problem !== null}
    <p class="px-4 py-3 text-small text-chat-failure/90">{sets.problem}</p>
  {:else if sets.known}
    <p class="px-4 py-3 text-small text-muted-foreground">
      {sets.enabled.includes(plugin) && !sets.sets.some((set) => set.plugin === plugin)
        ? `The plugin ${plugin} is starting or not running.`
        : `This project has no section ${plugin}/${view}.`}
    </p>
  {/if}
</div>
