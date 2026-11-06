import { mcpAppResult } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceUpdated } from '@runlith/mcp/resources';
import { Effect, PubSub, Schedule, Stream } from 'effect';
import type { McpResourceEvent } from '@runlith/mcp/apps';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginHost } from '../plugin-host/contract/service/supervision.js';
import { PluginTools } from '../plugin-host/contract/service/tools.js';
import { pluginToolName } from '../plugin-host/contract/wire/audience.js';
import { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import { type HeldContributions, PluginPoints } from '../plugins/contract/service/points.js';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import { COMPOSER, LAUNCHERS, PANES, RESULTS, SURFACES } from './contract/service/points.js';
import { PluginViews, type ViewFailure, type ViewMount } from './contract/service/views.js';
import type { SectionEntry } from './contract/wire/points.js';
import type { PluginViewSet, PluginViewState, ShownSection, ViewRefusalCode } from './contract/wire/sets.js';
import { makeBuilds } from './modules/builds.js';
import { callRefusal, READ_PLUGINS, refusal, unreadable } from './refusals.js';

const RECOVERY = Schedule.min([Schedule.exponential('500 millis'), Schedule.spaced('30 seconds')]);
const RETURNING: ReadonlySet<string> = new Set(['plugin-unavailable', 'plugin-view-unknown']);
const viewer = (mount: ViewMount): McpCaller => ({ kind: 'operator', projectId: mount.projectId, view: mount.view });
const resourceRefusal = (failure: { readonly _tag: string; readonly message: string }) =>
  refusal<ViewRefusalCode>(failure._tag === 'McpResourceFailed' ? 'plugin-resource-failed' : 'plugin-unavailable', failure.message);

export const makeShelf = Effect.gen(function* () {
  const enabledPlugins = yield* EnabledPlugins;
  const host = yield* PluginHost;
  const tools = yield* PluginTools;
  const moved = yield* Effect.acquireRelease(PubSub.unbounded<number | null>(), PubSub.shutdown);
  const bump = () => {
    PubSub.publishUnsafe(moved, null);
  };
  const points = yield* PluginPoints;
  const heard = Effect.fnUntraced(function* <W>(point: PluginFaced<W>) {
    const held = yield* points.hold(point);
    yield* Effect.acquireRelease(
      Effect.sync(() => held.changed(bump)),
      (unheard) => Effect.sync(unheard),
    );
    return held;
  });
  const results = yield* heard(RESULTS);
  const parts = yield* heard(COMPOSER);
  const surfaces = yield* heard(SURFACES);
  const panes = yield* heard(PANES);
  const launchers = yield* heard(LAUNCHERS);
  const builds = yield* makeBuilds({ changed: bump });

  const valueOf = <W>(held: HeldContributions<readonly W[]>, plugin: string): readonly W[] => held.of(plugin)?.value ?? [];

  const sectionsOf = (plugin: string, entries: readonly SectionEntry[]): readonly ShownSection[] =>
    entries.map(({ view, title, icon }) => ({ view, title, icon: icon === undefined ? null : builds.iconOf(plugin, icon) }));

  const setsOf = (enabled: readonly string[]): readonly PluginViewSet[] =>
    enabled.flatMap((id) => {
      const standing = builds.viewsOf(id);
      return standing === undefined
        ? []
        : [
            {
              plugin: id,
              title: standing.plugin.title,
              views: standing.views.map(({ id: view, live, media }) => ({
                id: view,
                live,
                media,
                module: builds.moduleOf(id, view) ?? { state: 'preparing' as const },
              })),
              results: valueOf(results, id).map((result) => ({ ...result, name: pluginToolName(id, result.tool) })),
              composer: valueOf(parts, id),
              surfaces: sectionsOf(id, valueOf(surfaces, id)),
              panes: sectionsOf(id, valueOf(panes, id)),
              launchers: valueOf(launchers, id),
            },
          ];
    });

  const mounted = Effect.fnUntraced(function* (mount: ViewMount) {
    const enabled = (yield* enabledPlugins.held(mount.projectId).pipe(Effect.mapError(unreadable)))();
    const standing = builds.viewsOf(mount.plugin);
    if (!enabled.includes(mount.plugin) || standing === undefined || !standing.views.some((view) => view.id === mount.view)) {
      return yield* new GateRefusal('plugin-view-unknown', `The plugin ${mount.plugin} shows this project no view ${mount.view}.`, [
        READ_PLUGINS,
      ]);
    }
    return standing.plugin;
  });

  yield* Effect.forkScoped(Stream.runForEach(enabledPlugins.changes, (project) => PubSub.publish(moved, project)));

  return {
    ...PluginViews.of({
      sets: (projectId) =>
        Stream.unwrap(
          Effect.map(PubSub.subscribe(moved), (moves) =>
            Stream.concat(Stream.succeed(null), Stream.fromSubscription(moves)).pipe(
              Stream.filter((move) => move === null || move === projectId),
              Stream.mapEffect(() =>
                Effect.map(enabledPlugins.held(projectId), (held): PluginViewState => {
                  const enabled = held();
                  return { plugins: setsOf(enabled), enabled, sheet: builds.sheet() };
                }),
              ),
              Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
            ),
          ),
        ),
      call: Effect.fn('PluginViews.call')(function* (mount, tool, args, caller) {
        const admit = Effect.gen(function* () {
          yield* mounted(mount);
          const offered = (yield* tools.of(mount.projectId).pipe(Effect.mapError(unreadable))).view(mount.plugin);
          if (!offered.some((descriptor) => descriptor.name === tool))
            return yield* new GateRefusal('plugin-tool-unoffered', `The plugin ${mount.plugin} offers its views no tool ${tool}.`, [
              'call a tool its tagma-plugin.json names with audience view',
            ]);
        });
        return yield* host.callAdmitted(mount.plugin, admit, tool, args, { caller }).pipe(
          Effect.mapError((failure) => (failure instanceof GateRefusal ? failure : callRefusal(failure))),
          Effect.map(mcpAppResult),
        );
      }),
      read: Effect.fn('PluginViews.read')(function* (mount, uri) {
        yield* mounted(mount);
        return yield* host.read(mount.plugin, uri, { caller: viewer(mount) }).pipe(Effect.mapError(resourceRefusal));
      }),
      watch: (mount, uri) => {
        const acquired = mounted(mount).pipe(
          Effect.andThen(host.subscribe(mount.plugin, uri, { caller: viewer(mount) }).pipe(Effect.mapError(resourceRefusal))),
        );
        const held = (opening: McpResourceEvent, updates: Stream.Stream<McpResourceUpdated>): Stream.Stream<McpResourceEvent> =>
          Stream.concat(
            Stream.succeed(opening),
            Stream.map(updates, (update): McpResourceEvent => ({ kind: 'updated', ...update })),
          );
        const again = (): Stream.Stream<McpResourceEvent, ViewFailure> =>
          Stream.concat(
            Stream.unwrap(
              acquired.pipe(
                Effect.retry({ while: (failure) => failure instanceof GateRefusal && RETURNING.has(failure.code), schedule: RECOVERY }),
                Effect.map((updates) => held({ kind: 'updated', uri }, updates)),
              ),
            ),
            Stream.suspend(() => again()),
          );
        return Stream.concat(
          Stream.unwrap(Effect.map(acquired, (updates) => held({ kind: 'subscribed' }, updates))),
          Stream.suspend(() => again()),
        );
      },
    }),
    mounted,
    moves: moved,
    bump,
    files: builds.files,
    candidates: builds.candidates,
    viewed: builds.viewed,
    surfaces,
    panes,
  };
});

export type ViewShelf = Effect.Success<typeof makeShelf>;
