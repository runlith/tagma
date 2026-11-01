import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { mcpAppResult } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceUpdated } from '@runlith/mcp/resources';
import { Effect, PubSub, Schedule, Stream } from 'effect';
import type { McpResourceEvent } from '../mcp/contract/wire/feeds.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { SettingChanges } from '../settings/contract/service/changes.js';
import { Settings } from '../settings/contract/service/values.js';
import { type TagmaAppContribution, TagmaAppPointRefused, type TagmaAppRef } from '../tagma-apps/contract/service/points.js';
import { TagmaApps } from '../tagma-apps/contract/service/supervision.js';
import { TagmaAppTools, TOOLS } from '../tagma-apps/contract/service/tools.js';
import { tagmaAppToolName } from '../tagma-apps/contract/wire/audience.js';
import { tagmaAppsEnabled } from '../tagma-apps/contract/wire/settings.js';
import { PANES, RESULTS, SURFACES, VIEWS } from './contract/service/points.js';
import { TagmaAppViews, type ViewFailure, type ViewMount, type ViewSites } from './contract/service/views.js';
import type { ResultEntries, ViewEntries } from './contract/wire/points.js';
import type { TagmaAppViewSet, TagmaAppViewState, ViewRefusalCode } from './contract/wire/sets.js';
import { makeLaunchers } from './launchers.js';
import { makeSections } from './sections.js';

type Shown = { readonly app: TagmaAppRef; readonly views: ViewEntries };
const RECOVERY = Schedule.min([Schedule.exponential('500 millis'), Schedule.spaced('30 seconds')]);
const RETURNING: ReadonlySet<string> = new Set(['app-unavailable', 'app-view-unknown']);
const READ_APPS = 'read_apps answers each app’s state and why it stopped';
const viewer = (mount: ViewMount): McpCaller => ({ kind: 'operator', projectId: mount.projectId, view: mount.view });
const refusedResults = (reason: string) => new TagmaAppPointRefused({ point: RESULTS.app.name, reason });
const refusal = (code: ViewRefusalCode, reason: string) =>
  new GateRefusal<ViewRefusalCode>(code, reason, code === 'app-unavailable' ? [READ_APPS] : ['try again', READ_APPS]);
const resourceRefusal = (failure: { readonly _tag: string; readonly message: string }) =>
  refusal(failure._tag === 'McpResourceFailed' ? 'app-resource-failed' : 'app-unavailable', failure.message);

export const makeShelf = Effect.gen(function* () {
  const settings = yield* Settings;
  const apps = yield* TagmaApps;
  const tools = yield* TagmaAppTools;
  const changes = yield* SettingChanges;
  const moved = yield* Effect.acquireRelease(PubSub.unbounded<number | null>(), PubSub.shutdown);
  const shown = new Map<string, Shown>();
  const results = new Map<string, ResultEntries>();
  const bump = () => {
    PubSub.publishUnsafe(moved, null);
  };
  const surfaces = makeSections({ point: SURFACES, changed: bump });
  const panes = makeSections({ point: PANES, changed: bump });
  const launchers = makeLaunchers({ changed: bump });

  const registerViews = ({ app, value }: TagmaAppContribution<ViewEntries>) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      const standing: Shown = { app, views: value };
      shown.set(app.id, standing);
      bump();
      return () => {
        if (shown.get(app.id) !== standing) return;
        shown.delete(app.id);
        bump();
      };
    });

  const registerResults = Effect.fnUntraced(function* ({ app, value, sibling }: TagmaAppContribution<ResultEntries>) {
    if (value.length === 0) return () => undefined;
    const views = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
    const unseen = value.filter((result) => !views.has(result.view)).map((result) => result.view);
    if (unseen.length > 0) return yield* refusedResults(`contributes.views declares no view ${unseen.join(', ')}`);
    const called = new Map((sibling(TOOLS) ?? []).map((tool) => [tool.name, tool.audience]));
    const silent = value.filter((result) => called.get(result.tool) === undefined || called.get(result.tool) === 'view');
    if (silent.length > 0)
      return yield* refusedResults(
        `no agent calls ${silent.map((result) => result.tool).join(', ')}; name it in contributes.tools for agents or own`,
      );
    results.set(app.id, value);
    bump();
    return () => {
      if (results.get(app.id) !== value) return;
      results.delete(app.id);
      bump();
    };
  });

  const setsOf = (enabled: readonly string[], sites: ViewSites['Service']): readonly TagmaAppViewSet[] =>
    enabled.flatMap((id) => {
      const standing = shown.get(id);
      return standing === undefined
        ? []
        : [
            {
              app: id,
              title: standing.app.title,
              site: sites.site(id),
              views: standing.views,
              results: (results.get(id) ?? []).map((result) => ({ ...result, name: tagmaAppToolName(id, result.tool) })),
              surfaces: surfaces.of(id),
              panes: panes.of(id),
              launchers: launchers.of(id),
            },
          ];
    });

  const mounted = Effect.fnUntraced(function* (mount: ViewMount) {
    const enabled = yield* settings.value(tagmaAppsEnabled, mount.projectId);
    const standing = shown.get(mount.app);
    if (!enabled.includes(mount.app) || standing === undefined || !standing.views.some((view) => view.id === mount.view)) {
      return yield* new GateRefusal('app-view-unknown', `The app ${mount.app} shows this project no view ${mount.view}.`, [READ_APPS]);
    }
    return standing.app;
  });

  const unwatch = changes.subscribe((event) => (event.key === tagmaAppsEnabled.id ? PubSub.publish(moved, event.projectId) : Effect.void));
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));

  return {
    ...TagmaAppViews.of({
      sets: (projectId, sites) =>
        Stream.unwrap(
          Effect.map(PubSub.subscribe(moved), (moves) =>
            Stream.concat(Stream.succeed(null), Stream.merge(Stream.fromSubscription(moves), Stream.as(sites.moved, null))).pipe(
              Stream.filter((move) => move === null || move === projectId),
              Stream.mapEffect(() =>
                Effect.map(settings.value(tagmaAppsEnabled, projectId), (enabled): TagmaAppViewState => ({
                  apps: setsOf(enabled, sites),
                  enabled,
                })),
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
      file: Effect.fn('TagmaAppViews.file')(function* (app, path) {
        const standing = shown.get(app);
        if (standing === undefined || !path.startsWith('ui/') || path.split('/').some((part) => part === '..' || part === '')) return null;
        const { root } = standing.app;
        return yield* Effect.promise(() =>
          Promise.all([realpath(root), realpath(join(root, 'ui')), realpath(join(root, path))]).then(
            ([home, views, file]) => (views === join(home, 'ui') && file.startsWith(`${views}${sep}`) ? file : null),
            () => null,
          ),
        );
      }),
      csp: (app, path) => Effect.succeed(shown.get(app)?.views.find((view) => view.entry === path)?.csp ?? {}),
      call: Effect.fn('TagmaAppViews.call')(function* (mount, tool, args, caller) {
        const admit = Effect.gen(function* () {
          yield* mounted(mount);
          const offered = (yield* tools.of(mount.projectId)).view(mount.app);
          if (!offered.some((descriptor) => descriptor.name === tool))
            return yield* new GateRefusal('app-tool-unoffered', `The app ${mount.app} offers its views no tool ${tool}.`, [
              'call a tool its tagma-app.json names with audience view',
            ]);
        });
        return yield* apps.callAdmitted(mount.app, admit, tool, args, { caller }).pipe(
          Effect.mapError((failure) => {
            switch (failure._tag) {
              case 'McpCallFailed':
              case 'McpTimedOut':
                return refusal('app-call-failed', failure.message);
              case 'McpConnectFailed':
              case 'McpNotConnected':
              case 'McpNeedsSignIn':
                return refusal('app-unavailable', failure.message);
              default:
                return failure;
            }
          }),
          Effect.map(mcpAppResult),
        );
      }),
      read: Effect.fn('TagmaAppViews.read')(function* (mount, uri) {
        yield* mounted(mount);
        return yield* apps.read(mount.app, uri, { caller: viewer(mount) }).pipe(Effect.mapError(resourceRefusal));
      }),
      watch: (mount, uri) => {
        const acquired = mounted(mount).pipe(
          Effect.andThen(apps.subscribe(mount.app, uri, { caller: viewer(mount) }).pipe(Effect.mapError(resourceRefusal))),
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
