<script lang="ts">
  import type { ComposerFace } from './composer.js';
  import PluginView from './PluginView.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  let { projectId, threadId, face }: { projectId: number; threadId: string | null; face: ComposerFace } = $props();

  const sets = ViewSets.use();
</script>

<div class="flex flex-col gap-1.5 pb-1.5">
  {#each sets.composerParts as part (`${part.plugin}\n${part.view}`)}
    <PluginView plugin={part.plugin} view={part.view} {projectId} {threadId} props={face} />
  {/each}
</div>
