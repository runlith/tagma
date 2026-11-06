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
import { PluginViewsLayer } from '$lib/features/plugin-views/layer.js';
import { FloatingPanels } from '$lib/features/plugin-views/windows/FloatingPanels.svelte.js';
import { NativeWindows } from '$lib/features/plugin-views/windows/NativeWindows.js';
import { ViewWindows } from '$lib/features/plugin-views/windows/ViewWindows.js';
import { ThreadTranscripts } from '$lib/features/plugin-views/ThreadTranscripts.js';
import { ViewThreads } from '$lib/features/plugin-views/ViewThreads.js';
import { ChatTranscripts } from '$lib/features/threads/ChatTranscripts.js';
import PlacedThread from '$lib/features/threads/seats/PlacedThread.svelte';
import { ThreadChats } from '$lib/features/threads/ThreadChats.js';
import { ProductRecords } from '$lib/features/threads/native/records.js';
import { PaletteRepo } from '$lib/features/palette/Repo.js';
import { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
import { ProjectsLayer } from '$lib/features/projects/layer.js';
import { RulesLayer } from '$lib/features/rules/layer.js';
import { PluginsLayer } from '$lib/features/plugins/layer.js';
import { SecretsRepo } from '$lib/features/secrets/Repo.js';
import { SettingsLayer } from '$lib/features/settings/layer.js';
import { ChoiceSets } from '$lib/features/settings/controls/catalogs.js';
import { Appearance } from '$lib/features/appearance/Appearance.svelte.js';
import { AppearanceLayer } from '$lib/features/appearance/layer.js';
import { ModelFields } from '$lib/features/settings/controls/modelField.js';
import ModelField from '$lib/features/threads/native/ModelField.svelte';
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
import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { ShellOps } from '$lib/features/workspace/ShellOps.js';
import { LAST_PROJECT_KEY, Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Visits, VISITS_KEY } from '$lib/features/workspace/Visits.svelte.js';
import { AppState } from '$lib/features/workspace/AppState.js';
import { ServerAppState } from '$lib/features/workspace/ServerAppState.svelte.js';
import { STRIP_KEY } from '$lib/features/projects/Strip.svelte.js';
import { RAIL_KEY } from '$lib/app/chrome/RailPins.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Failure } from '@runlith/layer/Failure';
import { Platform } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { SystemSettings } from '$lib/shared/SystemSettings.js';
import { Theme } from '$lib/shared/Theme.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { DesktopAppearance } from '$lib/shared/desktop/DesktopAppearance.js';
import { DesktopBrowser } from '$lib/shared/desktop/DesktopBrowser.js';
import { DesktopDictation } from '$lib/shared/desktop/DesktopDictation.js';
import { DesktopFolders } from '$lib/shared/desktop/DesktopFolders.js';
import { DesktopKeys } from '$lib/shared/desktop/DesktopKeys.js';
import { browserKept, DesktopKept, ShellKeys } from '$lib/features/shortcuts/kept.svelte.js';
import { ShortcutsLayer } from '$lib/features/shortcuts/layer.js';
import { DesktopSurface } from '$lib/shared/desktop/DesktopSurface.js';
import { DesktopSwipe } from '$lib/shared/desktop/DesktopSwipe.js';
import { DesktopTabs } from '$lib/shared/desktop/DesktopTabs.js';
import { DesktopUpdates } from '$lib/shared/desktop/DesktopUpdates.js';
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
      () => desktop?.keys !== undefined,
      Layer.provide(
        DesktopKeys,
        bridged((bridge) => {
          if (bridge.keys === undefined) throw new Error('This desktop shell publishes no keys');
          return bridge.keys;
        }),
      ),
    ),
    Layer.when(
      () => desktop?.updates !== undefined,
      Layer.provide(
        DesktopUpdates,
        bridged((bridge) => {
          if (bridge.updates === undefined) throw new Error('This desktop shell has no Check for Updates');
          return bridge.updates;
        }),
      ),
    ),
    Layer.when(
      () => desktop?.appearance !== undefined,
      Layer.provide(
        DesktopAppearance,
        bridged((bridge) => {
          if (bridge.appearance === undefined) throw new Error('This desktop shell follows no appearance');
          return bridge.appearance;
        }),
      ),
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
    TerminalsLayer,
    AccountsLayer,
    SpeechLayer,
    SettingsLayer,
    ActivityLayer,
    PowerLayer,
    ShellLayer,
    TelemetryLayer,
    ChoiceSets,
    AppearanceLayer,
    Layer.provide(Theme, function* () {
      return yield* Appearance;
    }),
    PaletteRepo,
    McpLayer,
    SecretsRepo,
    PluginsLayer,
    PluginViewsLayer,
    Layer.provide(ViewWindows, function* () {
      return (yield* Host).isDesktop ? new NativeWindows(bridged((bridge) => bridge.windows)()) : yield* FloatingPanels;
    }),
    Layer.provide(ThreadTranscripts, function* () {
      return new ChatTranscripts(yield* ThreadChats, yield* Door, yield* ProductRecords);
    }),
    Layer.of(ViewThreads, { Placed: PlacedThread }),
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
    ShortcutsLayer,
    Layer.provide(ShellKeys, function* () {
      const host = yield* Host;
      return host.isDesktop ? new DesktopKept(yield* DesktopKeys.optional(), host.apple) : browserKept(host);
    }),
    BrowserLayer,
    Screen,
    Layer.provide(ThreadOnScreen, function* () {
      return (yield* Host).kind === 'mobile' ? yield* Screen : yield* ThreadSeats;
    }),
    Layer.provide(ThreadPlaces, function* () {
      return yield* ThreadSeats;
    }),
    Layer.provide(AppState, function* () {
      const local = (yield* Platform).storage.local;
      return new ServerAppState(yield* Door, yield* Live, yield* Scope, yield* Failure, local, [
        STRIP_KEY,
        VISITS_KEY,
        RAIL_KEY,
        LAST_PROJECT_KEY,
      ]);
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
  );
}
