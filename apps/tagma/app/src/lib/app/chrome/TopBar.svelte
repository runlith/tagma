<script lang="ts">
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Search from '@lucide/svelte/icons/search';
  import { Router } from '@runlith/layer/Router';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { ProjectStrip } from '$lib/features/projects/Strip.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import CaptureChip from '$lib/features/speech/CaptureChip.svelte';
  import CallChip from '$lib/features/speech/calls/CallChip.svelte';
  import type { CallTarget } from '$lib/features/speech/calls/Calls.svelte.js';
  import { callPane } from '$lib/features/speech/panes.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import AreaToggle from '$lib/app/panes/AreaToggle.svelte';
  import { AreaFrame } from '$lib/app/panes/AreaFrame.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
  import TabStrip from '$lib/app/panes/TabStrip.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { ColumnRegistry } from './ColumnRegistry.js';
  import { Bar } from '../panes/Bar.svelte.js';
  import { Keymap } from '../keys/Keymap.svelte.js';
  import { Palette } from '../panes/palette.js';
  import BackForward from './BackForward.svelte';
  import WindowLights from './WindowLights.svelte';
  import NewProjectDialog from './NewProjectDialog.svelte';
  import RemoveProjectDialog from '$lib/features/projects/RemoveDialog.svelte';
  import RenameProjectDialog from '$lib/features/projects/RenameDialog.svelte';
  import GroupDialog from '$lib/features/projects/GroupDialog.svelte';
  import { ProjectCreation } from './ProjectCreation.svelte.js';
  import ProjectList from './ProjectList.svelte';
  import { STORAGE } from './projectStorage.js';
  import WorktreeSwitcher from './WorktreeSwitcher.svelte';
  import FinishDialog from '$lib/features/worktrees/FinishDialog.svelte';
  import CleanupDialog from '$lib/features/worktrees/CleanupDialog.svelte';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Host } from '@runlith/layer/Host';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';

  const ROOMY = 240;

  const overlay = Overlay.use();
  const panes = SidePanes.use();
  const seats = ThreadSeats.use();
  const frame = AreaFrame.use();
  const bar = Bar.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const workspace = Workspace.use();
  const strip = ProjectStrip.use();
  const tabs = $derived(strip.visible && strip.view === 'tabs');

  const host = Host.use();
  const keymap = Keymap.use();

  const router = Router.use();
  const inProject = $derived(Boolean(router.params.project));
  const context = $derived(workspace.contextProject);
  const surfaces = SurfaceRegistry.use();
  const columnRegistry = ColumnRegistry.use();
  const section = $derived(surfaces.get(surfaces.of(router.routeId, router.params)));

  const projectAim = ProjectRung.Source.use();
  const projectKey = $derived.by(() => {
    const aim = projectAim();
    return aim === undefined ? null : ProjectRung.keyOf(aim);
  });

  const creation = ProjectCreation.use();

  const app = App.current();
  const column = $derived(columnRegistry.at(router.routeId, router.params, inProject, app));

  let width = $state(0);
  const left = $derived(Math.max(0, width - frame.stage));
  const roomy = $derived(left >= ROOMY);
  const docked = $derived(inProject && panes.showing && frame.docked > 0);
  const searchHere = $derived(!(column?.open === true && column.search));
  const columns = $derived(`${roomy ? `${left}px` : 'fit-content(40%)'} minmax(0, 1fr)${docked ? ` ${frame.docked}px` : ''}`);
  const columnSeam = $derived(frame.column !== null && (roomy || frame.column.dragging) ? frame.column : null);
  const areaSeam = $derived(docked ? frame.area : null);

  const ZONE = 'flex h-full min-w-0 items-center gap-1';

  function openCall(target: CallTarget): void {
    const content = callPane(target);
    if (panes.holds(content)) panes.toggle(content);
    else void shell.openPane(content.kind, content.id);
  }

  function openPalette(): void {
    overlay.open(Palette, {});
  }
</script>

<header
  class="drag-region relative z-30 grid h-(--topbar) shrink-0 border-b bg-chrome"
  style:grid-template-columns={columns}
  bind:clientWidth={width}
  data-row
>
  <div class={[ZONE, tabs ? 'pl-3' : 'titlebar-inset', roomy && 'border-r', 'pr-2']} data-zone="place">
    {#if host.framed && !tabs}<WindowLights />{/if}
    {#if host.isDesktop || host.framed}<BackForward />{/if}
    <div class="flex min-w-0 items-center" data-place-crumb>
      {#if !tabs}
        <DropdownMenu.Root>
          <Tooltip
            text={context ? `${labelOf(context)} · ${STORAGE[context.storage].label} — ${STORAGE[context.storage].note}` : 'Open a project'}
          >
            <DropdownMenu.Trigger
              class={[
                'no-drag-region flex h-7 min-w-10 shrink items-center gap-1.5 rounded-md px-1.5 text-ui font-semibold transition-colors hover:bg-hover data-[state=open]:bg-selected',
              ]}
              aria-label={context === null ? 'Open a project' : `Project ${labelOf(context)}`}
            >
              {#if context}
                <Swatch projectId={context.id} />
              {/if}
              <FadeText text={context === null ? 'No project' : labelOf(context)} />
              {#if context === null}
                <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
              {/if}
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Content align="start" class="min-w-64">
            <ProjectList />
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
      {#if inProject && projectKey !== null}
        {#key projectKey}
          {#if !tabs}<span class="shrink-0 px-0.5 text-muted-foreground/45" aria-hidden="true">/</span>{/if}
          <WorktreeSwitcher />
          <FinishDialog />
          <CleanupDialog />
        {/key}
      {/if}
    </div>
    {#if searchHere || !roomy}
      <Tooltip text="Find or ask" keys={keymap.spell(keymap.mod('KeyK'))}>
        <Button
          variant="quiet"
          size="icon-sm"
          class={['no-drag-region', roomy && 'ml-auto']}
          aria-label="Find or ask"
          onclick={openPalette}
        >
          <Search class="size-3.5" />
        </Button>
      </Tooltip>
    {/if}
  </div>

  <div class={[ZONE, 'px-2']} data-zone="work">
    {#if inProject && projectKey !== null}
      {#key projectKey}
        {#if bar.zone !== null}
          {@render bar.zone()}
        {:else}
          <span class="flex min-w-0 items-center gap-1.5 px-2 text-ui">
            <span class={['shrink-0', bar.title === null ? 'font-medium' : 'text-muted-foreground']}>{section.label}</span>
            {#if bar.title !== null}
              <span class="shrink-0 text-muted-foreground/60">/</span>
              <FadeText class="font-medium" text={bar.title} />
            {/if}
          </span>
          <span class="flex-1"></span>
        {/if}
      {/key}
    {:else}
      <span class="flex-1"></span>
    {/if}
    <div class="no-drag-region flex shrink-0 items-center gap-1">
      <CaptureChip />
      <CallChip
        beside={(piece) => seats.ask({ kind: 'piece', piece })}
        transcript={{ holds: (target) => panes.holds(callPane(target)), toggle: openCall }}
      />
      {#if inProject && !docked}
        {#key projectKey}<AreaToggle />{/key}
      {/if}
    </div>
  </div>

  {#if docked}
    <div class={[ZONE, 'border-l pr-2']} data-zone="beside">
      {#key projectKey}
        <TabStrip class="self-stretch" />
      {/key}
    </div>
  {/if}

  {#if columnSeam !== null}
    <div class="absolute top-0 -bottom-px flex" style:left="{left}px">
      <SeamHandle seam={columnSeam} label="Resize the {column?.label ?? 'column'}" />
    </div>
  {/if}
  {#if areaSeam !== null}
    <div class="absolute top-0 -bottom-px flex" style:left="{width - frame.docked}px">
      <SeamHandle seam={areaSeam} label="Resize the area beside" />
    </div>
  {/if}
</header>

<NewProjectDialog bind:open={creation.open} />
<RemoveProjectDialog />
<RenameProjectDialog />
<GroupDialog />
