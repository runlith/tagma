<script lang="ts">
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Actions } from '$lib/features/workspace/action.js';
  import { launchesOf } from './launchers.js';
  import { ViewSets } from './ViewSets.svelte.js';
  import { ViewWindows } from './windows/ViewWindows.js';

  const LAUNCHERS = 'plugin-views:launchers';

  const sets = ViewSets.use();
  const actions = Actions.use();
  const windows = ViewWindows.use();
  const workspace = Workspace.use();

  const launches = $derived.by(() => {
    const project = workspace.contextProject;
    return project === null ? [] : launchesOf(sets.sets, project);
  });

  $effect(() => {
    return actions.register(LAUNCHERS, {
      id: LAUNCHERS,
      area: 'Plugins',
      actions: launches.map((launch) => ({
        id: `plugin.${launch.plugin}.${launch.view}`,
        title: launch.title,
        keywords: ['plugin', 'open', 'window', launch.plugin],
        order: 60,
        icon: AppWindow,
        available: (env) => env.project?.id === launch.projectId,
        run: () => windows.open(launch),
      })),
    });
  });
</script>
