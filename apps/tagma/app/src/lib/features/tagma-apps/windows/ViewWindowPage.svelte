<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { MainWindow } from '$lib/shared/desktop/MainWindow.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import TagmaAppView from '../TagmaAppView.svelte';
  import { MainWindowShell } from './MainWindowShell.js';
  import ViewWindowTitle from './ViewWindowTitle.svelte';

  const workspace = Workspace.use();
  const router = Router.use();
  const project = $derived(workspace.active);
  const tagmaApp = $derived(router.params.app ?? '');
  const view = $derived(router.params.view ?? '');
  const main = MainWindow.find();
  const visits = Visits.use();
  const shell = main === undefined ? undefined : new MainWindowShell(main, workspace, visits, Addresses.use());
</script>

<div class="h-full bg-background" data-tagma-app={tagmaApp} data-view={view}>
  {#if project !== null}
    {#key `${project.id}/${tagmaApp}/${view}`}
      <ViewWindowTitle {tagmaApp} {view} />
      <TagmaAppView {tagmaApp} {view} projectId={project.id} threadId={null} fill {shell} />
    {/key}
  {:else if workspace.loaded}
    <p class="px-4 py-3 text-small text-muted-foreground">No project named “{router.params.project}”.</p>
  {/if}
</div>
