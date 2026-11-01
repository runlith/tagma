import type { DesktopApi } from '@tagma/desktop/bridge';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Router } from '@runlith/layer/Router';
import { Cache } from '@runlith/query/repo';
import { AccountsLayer } from '$lib/features/providers/layer.js';
import { SpeechLayer } from '$lib/features/speech/layer.js';
import { CheckoutLayer } from '$lib/features/checkout/layer.js';
import { FilesLayer } from '$lib/features/checkout/files/layer.js';
import { MarkdownPreview } from '$lib/features/checkout/files/MarkdownPreview.js';
import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
import { PagesLayer } from '$lib/features/pages/layer.js';
import { PageTeams } from '$lib/features/pages/team.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { pageTeam } from '$lib/features/threads/team.js';
import { FrameLayer } from '$lib/app/chrome/layer.js';
import { CreationFields } from '$lib/app/chrome/creation.js';
import RemoteField from '$lib/features/graph/RemoteField.svelte';
import { GraphLayer } from '$lib/features/graph/layer.js';
import { HarnessLayer } from '$lib/features/threads/layer.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { NoticesLayer } from '$lib/features/notices/layer.js';
import { ReadingLayer } from '$lib/app/reading.layer.js';
import { PanesLayer } from '$lib/app/panes/layer.js';
import { OpeningLayer } from '$lib/app/opening/layer.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { BrowserLayer } from '$lib/features/browser/layer.js';
import { ActivityLayer } from '$lib/features/activity/layer.js';
import { DevicesLayer } from '$lib/features/devices/layer.js';
import { McpLayer } from '$lib/features/mcp/layer.js';
import { PowerLayer } from '$lib/features/power/layer.js';
import { ShellLayer } from '$lib/features/shell/layer.js';
import { TelemetryLayer } from '$lib/features/telemetry/layer.js';
import { TagmaAppsLayer } from '$lib/features/tagma-apps/layer.js';
import { FloatingPanels } from '$lib/features/tagma-apps/windows/FloatingPanels.svelte.js';
import { NativeWindows } from '$lib/features/tagma-apps/windows/NativeWindows.js';
import { ViewWindows } from '$lib/features/tagma-apps/windows/ViewWindows.js';
import { PaletteRepo } from '$lib/features/palette/Repo.js';
import { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
import { ProjectsLayer } from '$lib/features/projects/layer.js';
import { RulesLayer } from '$lib/features/rules/layer.js';
import { PluginsLayer } from '$lib/features/plugins/layer.js';
import { SecretsRepo } from '$lib/features/secrets/Repo.js';
import { SettingsLayer } from '$lib/features/settings/layer.js';
import { ModelChoices } from '$lib/features/settings/controls/catalogs.js';
import { ModelFields } from '$lib/features/settings/controls/modelField.js';
import ModelField from '$lib/features/threads/native/ModelField.svelte';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { modelChoices } from '$lib/features/providers/choices.js';
import { TerminalsLayer } from '$lib/features/executions/layer.js';
import { LocalFiles } from '$lib/features/executions/terminal/LocalFiles.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { TileRung } from '$lib/features/workspace/TileRung.js';
import { WorkspaceLayer } from '$lib/features/workspace/layer.js';
import { WorktreesLayer } from '$lib/features/worktrees/layer.js';
import { RETRIES, retriable } from '$lib/wire/refusal.js';
import { WireLayer } from '$lib/wire/wire.layer.js';
import { WireCatalog } from '$lib/wire/WireCatalog.js';
import { CATALOG_MODULES } from '@tagma/server/composition/catalog';
import type { CollectedDeclarations, CollectedFeeds } from '@tagma/server/platform/contract/wire/manifest';
import { PickScreen, type PickDraft } from '$lib/features/browser/pick/PickScreen.js';
import { CheckoutScreen } from '$lib/features/checkout/CheckoutScreen.js';
import { CallScreen, type CallDraft } from '$lib/features/speech/calls/CallScreen.js';
import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { ShellOps } from '$lib/features/workspace/ShellOps.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { SystemSettings } from '$lib/shared/SystemSettings.js';
import { Theme } from '$lib/shared/Theme.svelte.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { DesktopBrowser } from '$lib/shared/desktop/DesktopBrowser.js';
import { DesktopDictation } from '$lib/shared/desktop/DesktopDictation.js';
import { DesktopFolders } from '$lib/shared/desktop/DesktopFolders.js';
import { DesktopSurface } from '$lib/shared/desktop/DesktopSurface.js';
import { DesktopSwipe } from '$lib/shared/desktop/DesktopSwipe.js';
import { DesktopTabs } from '$lib/shared/desktop/DesktopTabs.js';
import { MainWindow } from '$lib/shared/desktop/MainWindow.js';
import { ProjectWindows } from '$lib/shared/desktop/ProjectWindows.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { SidePanes } from './panes/SidePanes.svelte.js';
import { ThreadPlaces } from './panes/ThreadPlaces.js';
import { DesktopShell } from './shell/DesktopShell.js';
import { MobileShell } from './shell/MobileShell.js';
import { Screen } from './mobile/Screen.svelte.js';
import { Overlays } from './overlays.js';

declare module '$lib/wire/operation.js' {
  interface Operations extends CollectedDeclarations<typeof CATALOG_MODULES> {}
}

declare module '$lib/wire/liveGroup.js' {
  interface Feeds extends CollectedFeeds<typeof CATALOG_MODULES> {}
}

declare module '@runlith/layer/key' {
  interface Ladder {
    tile: object;
    project: { under: 'tile' };
    graph: { under: 'project' };
    thread: { under: 'project' };
  }
}

export const LADDER = [TileRung, ProjectRung, ThreadRung, GraphRung] as const;

export function appLayers(desktop: DesktopApi | undefined) {
  const bridged =
    <T>(read: (bridge: DesktopApi) => T) =>
    (): T => {
      if (desktop === undefined) throw new Error('Host names the desktop, and this window has no desktop bridge');
      return read(desktop);
    };

  const DesktopLayer = Layer.mergeAll(
    Layer.provide(
      DesktopTabs,
      bridged((bridge) => bridge.tabs),
    ),
    Layer.provide(
      DesktopSwipe,
      bridged((bridge) => bridge.swipe),
    ),
    Layer.provide(
      DesktopBrowser,
      bridged((bridge) => bridge.browser),
    ),
    Layer.provide(
      DesktopDictation,
      bridged((bridge) => bridge.dictation),
    ),
    Layer.provide(
      DesktopFolders,
      bridged((bridge) => bridge.folders),
    ),
    Layer.provide(
      ProjectWindows,
      bridged((bridge) => bridge.windows),
    ),
    Layer.provide(
      MainWindow,
      bridged((bridge) => bridge.windows),
    ),
    Layer.when(
      () => desktop?.surface !== undefined,
      Layer.provide(
        DesktopSurface,
        bridged((bridge) => {
          if (bridge.surface === undefined) throw new Error('This desktop window switches no surface');
          return bridge.surface;
        }),
      ),
    ),
  );

  return Layer.mergeAll(
    WireLayer,
    WireCatalog.contribute('core', ...CATALOG_MODULES),
    WorkspaceLayer,
    ProjectsLayer,
    WorktreesLayer,
    NoticesLayer,
    ReadingLayer,
    GraphLayer,
    CreationFields.contribute('graph-remote', { id: 'graph-remote', order: 10, payload: { component: RemoteField } }),
    TerminalsLayer,
    AccountsLayer,
    SpeechLayer,
    SettingsLayer,
    ActivityLayer,
    PowerLayer,
    ShellLayer,
    TelemetryLayer,
    Layer.provide(ModelChoices, function* () {
      const catalog = yield* ProviderCatalog;
      return { entries: (of) => modelChoices(catalog.models, of) };
    }),
    PaletteRepo,
    McpLayer,
    SecretsRepo,
    PluginsLayer,
    TagmaAppsLayer,
    Layer.provide(ViewWindows, function* () {
      return (yield* Host).isDesktop ? new NativeWindows(bridged((bridge) => bridge.windows)()) : yield* FloatingPanels;
    }),
    Layer.when(Host, (host) => host.isDesktop, DesktopLayer),
    //! A dropped file's own path reaches only programs on the same machine, so it stands for a desktop on a loopback server.
    Layer.when(
      [Host, ServerOrigin],
      (host, origin) => host.isDesktop && origin.local,
      Layer.of(LocalFiles, { pathOf: (file: File) => desktop?.files?.pathOf(file) ?? '' }),
    ),
    //! The permission belongs to the Mac the server runs on, which only the desktop window stands on.
    Layer.when(Host, (host) => host.isDesktop && host.os === 'macos', SystemSettings),
    DevicesLayer,
    RulesLayer,
    HarnessLayer,
    PanesLayer,
    OpeningLayer,
    Keymap,
    BrowserLayer,
    Screen,
    Layer.provide(ThreadOnScreen, function* () {
      return (yield* Host).kind === 'mobile' ? yield* Screen : yield* ThreadSeats;
    }),
    Layer.provide(ThreadPlaces, function* () {
      return yield* ThreadSeats;
    }),
    Layer.provide(ShellOps, function* () {
      const router = yield* Router;
      const workspace = yield* Workspace;
      const visits = yield* Visits;
      const threads = yield* ThreadsRepo;
      const prefetch = yield* ProjectPrefetch;
      const surfaces = yield* SurfaceRegistry;
      const addresses = yield* Addresses;
      if ((yield* Host).kind === 'mobile') return new MobileShell(router, workspace, visits, surfaces, addresses, threads, prefetch);
      return new DesktopShell(router, workspace, visits, surfaces, addresses, threads, prefetch, yield* SidePanes, yield* ThreadSeats);
    }),
    Layer.provide(CallScreen, function* () {
      const screen = yield* ThreadOnScreen;
      return {
        get host(): CallDraft | null {
          const host = screen.host;
          if (host === null) return null;
          return {
            get canSend() {
              return host.canSend;
            },
            get thread() {
              return host.activeId === null ? null : { id: host.activeId, projectId: host.projectId };
            },
            stage: (piece) => host.draft.stagePiece(piece),
            send: () => host.writes.send(),
          };
        },
      };
    }),
    Layer.provide(CheckoutScreen, function* () {
      const screen = yield* ThreadOnScreen;
      return {
        get mainFocused() {
          return screen.mainFocused;
        },
      };
    }),
    Layer.provide(PickScreen, function* () {
      const screen = yield* ThreadOnScreen;
      return {
        get host(): PickDraft | null {
          const host = screen.host;
          if (host === null) return null;
          return {
            stageDocument: (document) => host.draft.stageDocument(document),
            attach: (files) => host.draft.attach(files),
          };
        },
      };
    }),
    CheckoutLayer,
    FilesLayer,
    Layer.of(MarkdownPreview, { Markdown: MarkdownBody }),
    Layer.of(ModelFields, { field: ModelField }),
    PagesLayer,
    Layer.provide(PageTeams, function* () {
      const list = yield* ThreadList;
      return { of: (threadId: string) => pageTeam(list.node(threadId), threadId) };
    }),
    FrameLayer,
    Cache.of({ defaultOptions: { queries: { retry: (count, error) => count < RETRIES && retriable(error) } } }),
    Overlays,
    Theme,
  );
}
