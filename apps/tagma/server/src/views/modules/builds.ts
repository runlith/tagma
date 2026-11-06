import { join } from 'node:path';
import { Clock, Effect, FiberMap, FileSystem, Option, Schema } from 'effect';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import { PluginDigests, PluginFaults } from '../../plugins/contract/service/plugins.js';
import { type PluginContribution, PluginPoints, type PluginRef } from '../../plugins/contract/service/points.js';
import { ViewCandidates, ViewFiles, ViewPlaces } from '../contract/service/places.js';
import { VIEWS } from '../contract/service/points.js';
import { GRAPH_FILE, GraphListing, VIEW_GRAPH } from '../contract/wire/graph.js';
import { moduleAddress, type ViewModule } from '../contract/wire/modules.js';
import type { ViewEntries } from '../contract/wire/points.js';
import { CompiledIndex, entriesOf, GONE, INDEX_FILE, keyOf, SOURCE, STAGED, stagerOf } from './compile.js';
import { makeCompiler, unprepared, ViewsUnprepared } from './compiler.js';
import { makeSheet } from './sheet.js';

type Ready = { readonly key: string; readonly index: CompiledIndex };

type Prepared =
  | { readonly _tag: 'preparing' }
  | ({ readonly _tag: 'ready' } & Ready)
  | { readonly _tag: 'failed'; readonly message: string; readonly file: string | null };

type Shown = {
  readonly contribution: PluginContribution<ViewEntries>;
  readonly plugin: PluginRef;
  readonly views: ViewEntries;
  prepared: Prepared;
  readonly last: Ready | null;
  candidates: readonly string[];
};

const POINT = 'views';

const MODULES = 'modules';

const NOT_COMPILED = 'A view of this plugin does not compile';

const decodeListing = Schema.decodeUnknownEffect(Schema.fromJsonString(GraphListing));

const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(CompiledIndex));

const graphPath = (path: string): string => `${VIEW_GRAPH}/${path}`;

const shownOf = (before: Shown | undefined): Ready | null => {
  if (before === undefined) return null;
  return before.prepared._tag === 'ready' ? before.prepared : before.prepared._tag === 'preparing' ? before.last : null;
};

export const makeBuilds = Effect.fnUntraced(function* (input: { readonly changed: () => void }) {
  const { changed } = input;
  const { home } = yield* ViewPlaces;
  const host = yield* PluginHost;
  const digests = yield* PluginDigests;
  const faults = yield* PluginFaults;
  const files = yield* FileSystem.FileSystem;
  const compiler = yield* makeCompiler;
  const held = yield* (yield* PluginPoints).hold(VIEWS);
  const preparing = yield* FiberMap.make<string>();
  const fork = yield* FiberMap.runtime(preparing)<never>();
  const shown = new Map<string, Shown>();
  const modules = join(home, MODULES);
  const sheet = yield* makeSheet({
    compiler,
    standing: () => [...shown.values()].map((one) => ({ preparing: one.prepared._tag === 'preparing', candidates: one.candidates })),
    changed,
  });

  const placeOf = (plugin: string): string => join(modules, plugin);

  const indexOf = (out: string) => files.readFileString(join(out, INDEX_FILE)).pipe(Effect.flatMap(decodeIndex), Effect.option);

  const retired = Effect.fnUntraced(function* (place: string, name: string) {
    const gone = join(place, `${name}.${process.pid}${GONE}`);
    yield* files.rename(join(place, name), gone);
    yield* files.remove(gone, { recursive: true });
  });

  const sweep = Effect.fn('PluginViews.sweep')(function* (place: string, current: string) {
    const kept: { readonly name: string; readonly at: number }[] = [];
    for (const name of yield* files.readDirectory(place)) {
      if (name === current || name === SOURCE) continue;
      if (name.endsWith(GONE) || (name.endsWith(STAGED) && stagerOf(name) !== process.pid))
        yield* files.remove(join(place, name), { recursive: true, force: true });
      else if (!name.endsWith(STAGED)) {
        const info = yield* files.stat(join(place, name));
        kept.push({ name, at: Option.getOrElse(info.mtime, () => new Date(0)).getTime() });
      }
    }
    const [, ...stale] = kept.sort((left, right) => right.at - left.at);
    yield* Effect.forEach(stale, ({ name }) => retired(place, name), { discard: true });
  });

  const listingOf = Effect.fnUntraced(function* (root: string) {
    const read = yield* files
      .readFileString(join(root, VIEW_GRAPH, GRAPH_FILE))
      .pipe(
        Effect.catchTag('PlatformError', () =>
          unprepared(`${graphPath(GRAPH_FILE)} is missing: build the plugin again with tagma-plugin build`),
        ),
      );
    return yield* decodeListing(read).pipe(
      Effect.mapError(
        (failure) =>
          new ViewsUnprepared({ reason: `${graphPath(GRAPH_FILE)} does not read: ${failure.message}`, file: GRAPH_FILE, moved: false }),
      ),
    );
  });

  const prepare = Effect.fnUntraced(function* (standing: Shown) {
    const { plugin, views } = standing;
    const entries = entriesOf(views);
    for (;;) {
      const listing = yield* listingOf(plugin.root);
      standing.candidates = listing.candidates;
      const absent = views.find((view) => listing.files[view.entry] === undefined);
      if (absent !== undefined)
        return yield* unprepared(`the view ${absent.id} names ${absent.entry}, which ${graphPath(GRAPH_FILE)} does not ship`, absent.entry);
      const shipped = Object.keys(listing.files).sort();
      const digest = yield* digests
        .digest(plugin.root, [graphPath(GRAPH_FILE), ...shipped.map(graphPath)])
        .pipe(Effect.mapError((failure) => new ViewsUnprepared({ reason: failure.message, file: null, moved: false })));
      if (digest === null)
        return yield* unprepared(`a file ${graphPath(GRAPH_FILE)} names is missing: build the plugin again with tagma-plugin build`);
      const key = keyOf(digest, entries);
      const standingIndex = yield* indexOf(join(placeOf(plugin.id), key));
      if (Option.isSome(standingIndex)) return { key, index: standingIndex.value };
      const root = yield* files
        .realPath(join(plugin.root, VIEW_GRAPH))
        .pipe(Effect.mapError((failure) => new ViewsUnprepared({ reason: failure.message, file: null, moved: false })));
      const answer = yield* compiler
        .compiled((id) => ({ id, kind: 'views', plugin: plugin.id, root, entries, place: placeOf(plugin.id) }))
        .pipe(
          Effect.map(Option.some),
          Effect.catchIf(
            (failure) => failure.moved,
            () => Effect.succeedNone,
          ),
        );
      if (Option.isNone(answer)) continue;
      return answer.value.kind === 'views'
        ? { key: answer.value.key, index: answer.value.index }
        : yield* unprepared('the compile worker answered a sheet for views');
    }
  });

  const settle = (standing: Shown, prepared: Prepared): void => {
    if (shown.get(standing.plugin.id) !== standing) return;
    standing.prepared = prepared;
    if (prepared._tag === 'failed')
      faults.put(standing.plugin.id, POINT, {
        title: NOT_COMPILED,
        detail: prepared.file === null ? prepared.message : `${prepared.file}: ${prepared.message}`,
      });
    else faults.clear(standing.plugin.id, POINT);
    sheet.refresh();
    changed();
  };

  const published = Effect.fnUntraced(function* (plugin: string, key: string) {
    const now = new Date(yield* Clock.currentTimeMillis);
    yield* files.utimes(join(placeOf(plugin), key), now, now);
    yield* sweep(placeOf(plugin), key);
  });

  const run = (standing: Shown) =>
    prepare(standing).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.sync(() => settle(standing, { _tag: 'failed', message: failure.reason, file: failure.file })),
        onSuccess: ({ key, index }) =>
          Effect.andThen(
            Effect.sync(() => settle(standing, { _tag: 'ready', key, index })),
            published(standing.plugin.id, key).pipe(
              Effect.catch((failure) => Effect.logWarning('stale plugin view builds stay on disk', failure.message)),
            ),
          ),
      }),
    );

  yield* Effect.forkScoped(
    host.started.pipe(
      Effect.andThen(files.exists(modules)),
      Effect.flatMap((exists) => (exists ? files.readDirectory(modules) : Effect.succeed([]))),
      Effect.flatMap((names) =>
        Effect.forEach(
          names.filter((name) => !shown.has(name)),
          (name) =>
            name.endsWith(GONE)
              ? files.remove(join(modules, name), { recursive: true, force: true })
              : FiberMap.run(preparing, name, retired(modules, name), { onlyIfMissing: true }),
          { discard: true },
        ),
      ),
      Effect.catch((failure) => Effect.logWarning('builds of plugins no longer published stay on disk', failure.message)),
    ),
  );

  const builtOf = (standing: Shown): Ready | null => (standing.prepared._tag === 'ready' ? standing.prepared : standing.last);

  const moduleOf = (plugin: string, view: string): ViewModule | undefined => {
    const standing = shown.get(plugin);
    const entry = standing?.views.find((candidate) => candidate.id === view)?.entry;
    if (standing === undefined || entry === undefined) return undefined;
    const { prepared } = standing;
    if (prepared._tag === 'failed') return { state: 'failed', message: prepared.message, file: prepared.file };
    const built = builtOf(standing);
    const file = built?.index.modules[entry];
    if (built !== null && file !== undefined) return { state: 'ready', address: moduleAddress(plugin, built.key, file) };
    return prepared._tag === 'preparing'
      ? { state: 'preparing' }
      : { state: 'failed', message: `the build made no module for ${entry}`, file: entry };
  };

  const iconOf = (plugin: string, path: string): string | null => {
    const standing = shown.get(plugin);
    const built = standing === undefined || standing.prepared._tag === 'failed' ? null : builtOf(standing);
    const file = built?.index.icons[path];
    return built === null || file === undefined ? null : moduleAddress(plugin, built.key, file);
  };

  const dropped = (plugin: string): void => {
    if (!shown.delete(plugin)) return;
    const fiber = FiberMap.getUnsafe(preparing, plugin);
    if (Option.isSome(fiber)) fiber.value.interruptUnsafe();
    faults.clear(plugin, POINT);
    sheet.refresh();
    changed();
  };

  const moved = (plugin: string): void => {
    const contribution = held.of(plugin);
    const before = shown.get(plugin);
    if (contribution === undefined || contribution.value.length === 0) return dropped(plugin);
    if (before?.contribution === contribution) return;
    const standing: Shown = {
      contribution,
      plugin: contribution.plugin,
      views: contribution.value,
      prepared: { _tag: 'preparing' },
      last: shownOf(before),
      candidates: before?.candidates ?? [],
    };
    shown.set(plugin, standing);
    changed();
    fork(plugin, run(standing));
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const unheard = held.changed(moved);
      for (const plugin of held.all().keys()) moved(plugin);
      return unheard;
    }),
    (unheard) => Effect.sync(unheard),
  );

  return {
    moduleOf,
    iconOf,
    sheet: sheet.address,
    viewsOf: (plugin: string): { readonly plugin: PluginRef; readonly views: ViewEntries } | undefined => shown.get(plugin),
    viewed: (): ReadonlyMap<string, PluginRef> => new Map([...shown].map(([id, standing]) => [id, standing.plugin])),
    files: ViewFiles.of({
      module: (plugin, key, file) => join(placeOf(plugin), key, file),
      sheet: sheet.file,
    }),
    candidates: ViewCandidates.of({
      listed: () => [...new Set([...shown.values()].flatMap((standing) => standing.candidates))].sort(),
    }),
  };
});
