<script lang="ts">
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { Router } from '@runlith/layer/Router';
  import { Button } from '$lib/shared/ui/button/index.js';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ProjectCreation } from './ProjectCreation.svelte.js';

  const workspace = Workspace.use();
  const visits = Visits.use();
  const router = Router.use();
  const creation = ProjectCreation.use();

  $effect(() => {
    if (workspace.empty) return;
    const entry = workspace.entryProject();
    if (entry !== null) void router.goto(visits.resume(entry.name), { replaceState: true });
  });
</script>

{#if workspace.empty}
  <div class="grid h-full place-items-center px-6">
    <div class="grid max-w-sm justify-items-center text-center">
      <AgentIcon march brand class="size-24" />
      <h1 class="mt-5 text-page">Start with a project folder</h1>
      <p class="mt-2 text-body leading-relaxed text-muted-foreground">
        Choose the folder of a repository you work on. Tagma keeps what it learns about it, and agents work there.
      </p>
      <Button class="mt-5" disabled={creation.creating} onclick={() => void creation.start()} data-start-folder>
        <FolderOpen class="size-4" />
        {creation.creating ? 'Adding the project…' : 'Choose a folder…'}
      </Button>
    </div>
  </div>
{/if}
