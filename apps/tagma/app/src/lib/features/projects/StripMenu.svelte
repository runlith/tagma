<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import PanelTop from '@lucide/svelte/icons/panel-top';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import FolderMinus from '@lucide/svelte/icons/folder-minus';
  import X from '@lucide/svelte/icons/x';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ContextAim } from '$lib/features/threads/contextAim.svelte.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { ProjectWindows } from '$lib/shared/desktop/ProjectWindows.js';
  import { ProjectRemoval } from './Removal.svelte.js';
  import { ProjectStrip } from './Strip.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';

  let { aim, project }: { aim: ContextAim; project: Project | null } = $props();

  const strip = ProjectStrip.use();
  const removal = ProjectRemoval.use();
  const visits = Visits.use();
  const windows = ProjectWindows.find();
  const open = $derived(aim.anchor !== null && project !== null);

  function setOpen(next: boolean): void {
    if (!next) aim.clear();
  }
</script>

<DropdownMenu.Root bind:open={() => open, setOpen}>
  <DropdownMenu.Content anchor={aim.anchor ?? undefined} align="start" sideOffset={0} class="min-w-52" returnFocus={false}>
    {#if project !== null}
      <DropdownMenu.Label>{labelOf(project)}</DropdownMenu.Label>
      <DropdownMenu.Item icon={X} onSelect={() => strip.remove(project.id)}>Remove from strip</DropdownMenu.Item>
      <DropdownMenu.Separator />
      {#if windows !== undefined}
        <DropdownMenu.Item icon={AppWindow} onSelect={() => windows.openProject(visits.resume(project.name))}>
          Open in New Window
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
      {/if}
      {#if strip.view === 'dock'}
        <DropdownMenu.Item icon={PanelTop} onSelect={() => strip.show('tabs')}>Show as tabs</DropdownMenu.Item>
      {:else}
        <DropdownMenu.Item icon={PanelLeft} onSelect={() => strip.show('dock')}>Show as dock</DropdownMenu.Item>
      {/if}
      {#if !project.global}
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" icon={FolderMinus} onSelect={() => removal.ask(project)}>
          Remove from Tagma…
        </DropdownMenu.Item>
      {/if}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
