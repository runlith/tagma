<script lang="ts">
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import SettingsPage from '$lib/features/settings/SettingsPage.svelte';
  import PageHeader from '$lib/shared/PageHeader.svelte';
  import { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import ProjectHold from '$lib/features/workspace/ProjectHold.svelte';
  import { SettingsColumn } from '$lib/features/settings/SettingsColumn.svelte.js';

  const workspace = Workspace.use();
  const column = SettingsColumn.use();
  const router = Router.use();
  const aimed = $derived(router.url.searchParams.get('project'));
  const project = $derived(workspace.named(aimed) ?? workspace.contextProject);

  const section = App.section('settings', 'app');
  let catalogLife: ReturnType<typeof section.child> | null = null;
  let catalog = $state<SettingsCatalog | null>(null);

  $effect(() => {
    const loaded = workspace.loaded;
    const projectId = project?.id;
    untrack(() => {
      if (!loaded || projectId === catalog?.projectId) return;
      const leaving = catalogLife;
      if (projectId === undefined) {
        catalogLife = null;
        catalog = null;
      } else {
        catalogLife = section.child('settings-catalog');
        catalog = SettingsCatalog.start(catalogLife, { projectId });
      }
      if (leaving !== null) void leaving.close();
    });
  });

  const active = $derived(router.url.searchParams.get('section') ?? column.last ?? 'agent');

  const asked = $derived(router.url.searchParams.get('scope'));
  const scope = $derived<SettableScope>(
    project === null ? 'user' : asked === 'user' || asked === 'project' ? asked : (column.lastScope ?? 'project'),
  );

  const NARROW_BELOW = 900;
  const RAIL = 48;
  let width = $state(typeof window === 'undefined' ? 0 : window.innerWidth - RAIL);

  $effect(() => {
    const room = width >= NARROW_BELOW;
    untrack(() => column.fit(room));
  });
</script>

<svelte:head><title>Settings</title></svelte:head>

{#if catalog !== null}
  {#key catalog.projectId}
    <ProjectHold projectId={catalog.projectId}>
      <div class="h-full min-h-0" bind:clientWidth={width}>
        <SettingsPage
          {catalog}
          {active}
          {scope}
          column={column.shown}
          oncollapse={() => column.toggle()}
          onvisit={(id, at) => column.visit(id, at)}
        />
      </div>
    </ProjectHold>
  {/key}
{:else}
  <div class="page-wide pt-8 pb-16">
    <PageHeader
      title="Settings"
      caption={workspace.loaded ? 'Register a project to resolve its settings.' : 'Reading the project registry…'}
    />
  </div>
{/if}
