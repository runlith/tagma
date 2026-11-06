import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { mcpAppResult } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceUpdated } from '@runlith/mcp/resources';
import { Effect, PubSub, Schedule, Stream } from 'effect';
import type { McpResourceEvent } from '../mcp/contract/wire/feeds.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginHost } from '../plugin-host/contract/service/supervision.js';
import { PluginTools } from '../plugin-host/contract/service/tools.js';
import { pluginToolName } from '../plugin-host/contract/wire/audience.js';
import { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import type { PluginContribution, PluginRef } from '../plugins/contract/service/points.js';
import { PANES, RESULTS, SURFACES, VIEWS } from './contract/service/points.js';
import { PluginViews, type ViewFailure, type ViewMount, type ViewSites } from './contract/service/views.js';
import type { ResultEntries, ViewEntries } from './contract/wire/points.js';
import type { PluginViewSet, PluginViewState, ViewRefusalCode } from './contract/wire/sets.js';
import { makeLaunchers } from './launchers.js';
import { callRefusal, READ_PLUGINS, refusal, unreadable } from './refusals.js';
import { makeSections } from './sections.js';

type Shown = { readonly plugin: PluginRef; readonly views: ViewEntries };
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
  const shown = new Map<string, Shown>();
  const results = new Map<string, ResultEntries>();
  const bump = () => {
    PubSub.publishUnsafe(moved, null);
  };
  const surfaces = makeSections({ point: SURFACES, changed: bump });
  const panes = makeSections({ point: PANES, changed: bump });
  const launchers = makeLaunchers({ changed: bump });

  const registerViews = ({ plugin, value }: PluginContribution<ViewEntries>) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      const standing: Shown = { plugin, views: value };
      shown.set(plugin.id, standing);
      bump();
      return () => {
        if (shown.get(plugin.id) !== standing) return;
        shown.delete(plugin.id);
        bump();
      };
    });

  const registerResults = ({ plugin, value }: PluginContribution<ResultEntries>) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      results.set(plugin.id, value);
      bump();
      return () => {
        if (results.get(plugin.id) !== value) return;
        results.delete(plugin.id);
        bump();
      };
    });

  const setsOf = (enabled: readonly string[], sites: ViewSites['Service']): readonly PluginViewSet[] =>
    enabled.flatMap((id) => {
      const standing = shown.get(id);
      return standing === undefined
        ? []
        : [
            {
              plugin: id,
              title: standing.plugin.title,
              site: sites.site(id),
              views: standing.views,
              results: (results.get(id) ?? []).map((result) => ({ ...result, name: pluginToolName(id, result.tool) })),
              surfaces: surfaces.of(id),
              panes: panes.of(id),
              launchers: launchers.of(id),
            },
          ];
    });

  const mounted = Effect.fnUntraced(function* (mount: ViewMount) {
    const enabled = (yield* enabledPlugins.held(mount.projectId).pipe(Effect.mapError(unreadable)))();
    const standing = shown.get(mount.plugin);
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
      sets: (projectId, sites) =>
        Stream.unwrap(
          Effect.map(PubSub.subscribe(moved), (moves) =>
            Stream.concat(Stream.succeed(null), Stream.merge(Stream.fromSubscription(moves), Stream.as(sites.moved, null))).pipe(
              Stream.filter((move) => move === null || move === projectId),
              Stream.mapEffect(() =>
                Effect.map(enabledPlugins.held(projectId), (held): PluginViewState => {
                  const enabled = held();
                  return { plugins: setsOf(enabled, sites), enabled };
                }),
              ),
              Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
            ),
          ),
        ),
      standing: Stream.unwrap(
        Effect.map(PubSub.subscribe(moved), (moves) =>
          Stream.concat(Stream.succeed(null), Stream.fromSubscription(moves)).pipe(
            Stream.map((): ReadonlySet<string> => new Set(shown.keys())),
            Stream.changesWith((left, right) => left.size === right.size && [...left].every((id) => right.has(id))),
          ),
        ),
      ),
      file: Effect.fn('PluginViews.file')(function* (plugin, path) {
        const standing = shown.get(plugin);
        if (standing === undefined || !path.startsWith('ui/') || path.split('/').some((part) => part === '..' || part === '')) return null;
        const { root } = standing.plugin;
        return yield* Effect.promise(() =>
          Promise.all([realpath(root), realpath(join(root, 'ui')), realpath(join(root, path))]).then(
            ([home, views, file]) => (views === join(home, 'ui') && file.startsWith(`${views}${sep}`) ? file : null),
            () => null,
          ),
        );
      }),
      csp: (plugin, path) => Effect.succeed(shown.get(plugin)?.views.find((view) => view.entry === path)?.csp ?? {}),
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
    viewed: (): ReadonlyMap<string, PluginRef> => new Map([...shown].map(([id, standing]) => [id, standing.plugin])),
    contributions: {
      views: { point: VIEWS, register: registerViews },
      results: { point: RESULTS, register: registerResults },
      surfaces,
      panes,
      launchers,
    },
  };
});

export type ViewShelf = Effect.Success<typeof makeShelf>;
