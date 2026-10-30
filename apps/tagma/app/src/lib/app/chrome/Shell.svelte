<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import { Overlay } from '@runlith/primitives/Overlay.svelte';
  import { Router } from '@runlith/layer/Router';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { CHAT, SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { ProjectSwitchWatch } from '$lib/features/projects/switchRecord.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { TileRung } from '$lib/features/workspace/TileRung.js';
  import { Topics } from '$lib/shared/threads/Topics.svelte.js';
  import DesktopTabKeys from '$lib/features/checkout/files/DesktopTabKeys.svelte';
  import DictationKeys from '$lib/features/speech/dictation/Keys.svelte';
  import CallKeys from '$lib/features/speech/calls/CallKeys.svelte';
  import ShellTagmaApps from '$lib/features/tagma-apps/ShellTagmaApps.svelte';
  import DictationArm from '$lib/features/speech/dictation/Arm.svelte';
  import TerminalCloses from '$lib/features/executions/terminal/CloseDialogs.svelte';
  import TerminalPanel from '$lib/features/executions/terminal/Panel.svelte';
  import RightArea from '../panes/RightArea.svelte';
  import FrameFollow from './FrameFollow.svelte';
  import { AreaFrame } from '../panes/AreaFrame.svelte.js';
  import { areaChord } from '../panes/areaChord.js';
  import { SidePanes } from '../panes/SidePanes.svelte.js';
  import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
  import { Keymap } from '../keys/Keymap.svelte.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { ColumnRegistry } from './ColumnRegistry.js';
  import { standingKey } from '$lib/features/workspace/standing.js';
  import NavigationRail from './NavigationRail.svelte';
  import Dock from '$lib/features/projects/Dock.svelte';
  import ProjectKeys from '$lib/features/projects/ProjectKeys.svelte';
  import { ProjectStrip } from '$lib/features/projects/Strip.svelte.js';
  import TabRow from '$lib/features/projects/TabRow.svelte';
  import WarmHolds from '$lib/features/projects/WarmHolds.svelte';
  import { Host } from '@runlith/layer/Host';
  import ProjectList from './ProjectList.svelte';
  import { Palette } from '../panes/palette.js';
  import StatusBar from './StatusBar.svelte';
  import TopBar from './TopBar.svelte';
  import HistorySwipe from './HistorySwipe.svelte';
  import RestartNotice from './RestartNotice.svelte';
  import RecoveryBanner from '$lib/features/graph/RecoveryBanner.svelte';

  let { children }: { children: Snippet } = $props();

  const overlay = Overlay.use();
  const app = App.current();
  const host = Host.use();
  const strip = ProjectStrip.use();
  const router = Router.use();
  const surfaces = SurfaceRegistry.use();
  const columns = ColumnRegistry.use();
  const framed = $derived(columns.at(router.routeId, Boolean(router.params.project), app));
  const surface = $derived(surfaces.of(router.routeId));

  const panes = SidePanes.use();
  const away = (): void => panes.focusOn(null);
  const seats = ThreadSeats.use();
  const area = AreaFrame.use();
  const topics = Topics.use();
  const keymap = Keymap.use();
  const projectAim = ProjectRung.Source.use();
  const projectKey = $derived(router.params.project ? (projectAim()?.projectId ?? null) : null);

  const section = $derived(projectKey === null ? null : surfaces.of(router.routeId, router.params));
  $effect(() => {
    const shown = section;
    untrack(() => panes.showSection(shown));
  });

  const workspace = Workspace.use();
  const switches = new ProjectSwitchWatch(app);
  onDestroy(() => switches.close());
  onDestroy(
    router.onNavigate({
      before: (navigation) => {
        const startedAt = performance.now();
        const to = navigation.to;
        const project = workspace.projects.find((project) => project.name === to?.params.project);
        const changed = to !== null && navigation.from?.params.project !== to.params.project;
        switches.begin(
          !changed || project === undefined || to === null
            ? null
            : {
                projectId: project.id,
                project: project.name,
                threadId: surfaces.of(to.routeId) === CHAT ? (to.params.id ?? null) : null,
              },
          navigation.type,
          startedAt,
        );
      },
      after: (navigation) => {
        const to = navigation.to;
        if (to === null) return;
        switches.navigated(to.params.project, surfaces.of(to.routeId) === CHAT ? (to.params.id ?? null) : null);
      },
    }),
  );
  $effect(() => switches.follow());

  const graphAim = GraphRung.Source.use();
  const graphKey = $derived.by(() => {
    const aim = graphAim();
    return aim === undefined ? null : GraphRung.keyOf(aim);
  });
  const tileAim = TileRung.Source.use();
  const frameKey = $derived.by(() => {
    if (framed?.stands !== 'tile') return standingKey(surfaces.get(surface).stands, projectAim(), graphAim());
    const tile = tileAim();
    return tile === undefined || projectAim() === undefined ? null : `tile:${TileRung.keyOf(tile)}`;
  });
  const frame = $derived(framed?.frame === undefined || !framed.open ? null : framed.frame());

  const togglePalette = (group?: 'files'): true => {
    if (overlay.isOpen(Palette)) overlay.close(Palette);
    else overlay.open(Palette, group === undefined ? {} : { group });
    return true;
  };

  $effect(() =>
    keymap.bind([
      { chord: keymap.mod('KeyK'), run: () => togglePalette() },
      { chord: keymap.mod('KeyP'), run: () => projectKey !== null && togglePalette('files') },
      {
        chord: keymap.mod('Backslash'),
        run: () => {
          if (framed === null) return false;
          framed.toggle();
          return true;
        },
      },
      {
        chord: areaChord(keymap),
        run: () => {
          if (projectKey === null || panes.panes.length === 0) return false;
          panes.showArea(!panes.showing);
          return true;
        },
      },
      {
        chord: keymap.mod('KeyI'),
        run: () => {
          const topic = topics.current;
          if (projectKey === null || topic === null) return false;
          seats.ask(topic);
          return true;
        },
      },
      {
        chord: keymap.mod('Comma'),
        run: () => {
          void router.goto(settingsHref(router));
          return true;
        },
      },
    ]),
  );
</script>

{#snippet dock()}<Dock />{/snippet}

<DictationKeys />
<CallKeys />
<ShellTagmaApps />
<WarmHolds />
<DictationArm />
{#if host.isDesktop && host.os === 'macos'}
  <ProjectKeys cycling={() => overlay.isOpen(Palette) && overlay.close(Palette)} />
  <HistorySwipe />
{/if}
{#if graphKey !== null}
  {#key graphKey}
    <DesktopTabKeys />
  {/key}
{/if}

<div class="flex h-full flex-col">
  {#if strip.visible && strip.view === 'tabs'}
    <TabRow>
      {#snippet list()}<ProjectList />{/snippet}
    </TabRow>
  {/if}
  <TopBar />
  <RestartNotice />
  {#if projectKey !== null}
    {#key projectKey}
      <RecoveryBanner />
    {/key}
  {/if}
  <div class="flex min-h-0 flex-1">
    <NavigationRail projects={strip.visible && strip.view === 'dock' ? dock : undefined} />
    {#if frame !== null && frameKey !== null}
      {#await frame then loaded}
        {@const Frame = loaded.default}
        {#key frameKey}
          <div class="contents" onpointerdowncapture={away} onfocusin={away}>
            <ErrorBoundary id="column">
              <Frame />
            </ErrorBoundary>
          </div>
        {/key}
      {/await}
    {/if}
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" bind:clientWidth={() => area.stage, (width) => area.measure(width)}>
      <div class="relative flex min-h-0 min-w-0 flex-1">
        <main
          class="@container/page min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          onpointerdowncapture={away}
          onfocusin={away}
        >
          <ErrorBoundary id="page">
            {@render children()}
          </ErrorBoundary>
        </main>
        {#if projectKey !== null}
          {#key projectKey}
            <FrameFollow />
            <TerminalCloses />
            <ErrorBoundary id="right area">
              <RightArea />
            </ErrorBoundary>
          {/key}
        {/if}
      </div>
      {#if projectKey !== null}
        {#key projectKey}
          <div class="contents" onpointerdowncapture={away} onfocusin={away}>
            <ErrorBoundary id="terminals">
              <TerminalPanel />
            </ErrorBoundary>
          </div>
        {/key}
      {/if}
    </div>
  </div>
  <ErrorBoundary id="status bar">
    <StatusBar />
  </ErrorBoundary>
</div>
