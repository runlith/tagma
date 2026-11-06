import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { workerLink } from '@runlith/utils/worker';
import { Data, Effect, FiberMap, FileSystem, Option, Schema } from 'effect';
import svelte from 'svelte/package.json' with { type: 'json' };
import { PluginDigests, PluginFaults } from '../../plugins/contract/service/plugins.js';
import type { PluginRef } from '../../plugins/contract/service/points.js';
import { ViewFiles, ViewPlaces } from '../contract/service/places.js';
import { compileSignature } from '../contract/wire/compile.js';
import { GRAPH_FILE, VIEW_GRAPH, ViewGraph } from '../contract/wire/graph.js';
import { moduleAddress, type ViewModule } from '../contract/wire/modules.js';
import type { ViewEntries } from '../contract/wire/points.js';
import { type CompileAnswer, type CompileAsk, CompiledIndex, INDEX_FILE } from './compile.js';

type Prepared =
  | { readonly _tag: 'preparing' }
  | { readonly _tag: 'ready'; readonly key: string; readonly index: CompiledIndex }
  | { readonly _tag: 'failed'; readonly message: string; readonly file: string | null };

type Shown = {
  readonly plugin: PluginRef;
  readonly views: ViewEntries;
  prepared: Prepared;
  candidates: readonly string[];
};

const PICTURE = /\.(?:svg|png|webp|gif|jpg)$/u;

class ViewsUnprepared extends Data.TaggedError('ViewsUnprepared')<{ readonly reason: string; readonly file: string | null }> {
  override get message(): string {
    return this.reason;
  }
}

const POINT = 'views';

const IDLE = '5 minutes';

const decodeGraph = Schema.decodeUnknownEffect(Schema.fromJsonString(ViewGraph));

const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(CompiledIndex));

const graphPath = (path: string): string => `${VIEW_GRAPH}/${path}`;

const keyOf = (digest: string): string =>
  createHash('sha256').update(`${digest}\0${svelte.version}\0${compileSignature()}`).digest('hex').slice(0, 24);

const NOT_COMPILED = 'A view of this plugin does not compile';

export const makeBuilds = Effect.fnUntraced(function* (input: { readonly changed: () => void }) {
  const { changed } = input;
  const { home } = yield* ViewPlaces;
  const digests = yield* PluginDigests;
  const faults = yield* PluginFaults;
  const files = yield* FileSystem.FileSystem;
  const preparing = yield* FiberMap.make<string>();
  const resting = yield* FiberMap.make<'idle'>();
  const link = yield* Effect.acquireRelease(
    Effect.sync(() =>
      workerLink<CompileAsk, CompileAnswer>(
        'view compile worker',
        () => new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' }),
      ),
    ),
    (standing) => standing.shutdown('the plugin views closed'),
  );
  const shown = new Map<string, Shown>();
  let asking = 0;

  const placeOf = (plugin: string, key: string): string => join(home, 'modules', plugin, key);

  const unprepared = (reason: string, file: string | null = null) => Effect.fail(new ViewsUnprepared({ reason, file }));

  const indexOf = (out: string) => files.readFileString(join(out, INDEX_FILE)).pipe(Effect.flatMap(decodeIndex), Effect.option);

  const compiled = Effect.fn('PluginViews.compile')(function* (ask: Omit<CompileAsk, 'id'>) {
    asking += 1;
    yield* FiberMap.remove(resting, 'idle');
    const answer = yield* link
      .ask((id) => ({ ...ask, id }))
      .pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            asking -= 1;
            return asking > 0
              ? Effect.void
              : FiberMap.run(resting, 'idle', Effect.sleep(IDLE).pipe(Effect.andThen(Effect.sync(() => link.close('it rested')))));
          }),
        ),
        Effect.catchTag('WorkerUnavailable', (gone) => unprepared(gone.message)),
      );
    return answer.ok ? answer.index : yield* unprepared(answer.message, answer.file);
  });

  const sweep = Effect.fn('PluginViews.sweep')(function* (plugin: string, key: string) {
    const place = join(home, 'modules', plugin);
    const names = yield* files.readDirectory(place);
    const dated = yield* Effect.forEach(
      names.filter((name) => name !== key),
      (name) =>
        Effect.map(files.stat(join(place, name)), (info) => ({ name, at: Option.getOrElse(info.mtime, () => new Date(0)).getTime() })),
    );
    const [kept, ...stale] = dated.sort((left, right) => right.at - left.at);
    const removed = kept?.name.endsWith('.partial') === true ? [kept, ...stale] : stale;
    yield* Effect.forEach(removed, ({ name }) => files.remove(join(place, name), { recursive: true }), { discard: true });
  });

  const prepare = Effect.fnUntraced(function* (standing: Shown) {
    const { plugin, views } = standing;
    const read = yield* files
      .readFileString(join(plugin.root, VIEW_GRAPH, GRAPH_FILE))
      .pipe(
        Effect.catchTag('PlatformError', () =>
          unprepared(`${graphPath(GRAPH_FILE)} is missing: build the plugin again with tagma-plugin build`),
        ),
      );
    const graph = yield* decodeGraph(read).pipe(
      Effect.mapError(
        (failure) => new ViewsUnprepared({ reason: `${graphPath(GRAPH_FILE)} does not read: ${failure.message}`, file: GRAPH_FILE }),
      ),
    );
    standing.candidates = graph.candidates;
    const absent = views.find((view) => graph.files[view.entry] === undefined);
    if (absent !== undefined)
      return yield* unprepared(`the view ${absent.id} names ${absent.entry}, which ${graphPath(GRAPH_FILE)} does not ship`, absent.entry);
    const shipped = Object.keys(graph.files);
    const digest = yield* digests
      .views(plugin.root, [graphPath(GRAPH_FILE), ...shipped.map(graphPath)])
      .pipe(Effect.mapError((failure) => new ViewsUnprepared({ reason: failure.message, file: null })));
    if (digest === null)
      return yield* unprepared(`a file ${graphPath(GRAPH_FILE)} names is missing: build the plugin again with tagma-plugin build`);
    const key = keyOf(digest);
    const out = placeOf(plugin.id, key);
    const standingIndex = yield* indexOf(out);
    const index = Option.isSome(standingIndex)
      ? standingIndex.value
      : yield* compiled({
          kind: 'views',
          root: yield* files
            .realPath(join(plugin.root, VIEW_GRAPH))
            .pipe(Effect.mapError((failure) => new ViewsUnprepared({ reason: failure.message, file: null }))),
          graph,
          entries: [...new Set(views.map((view) => view.entry))],
          icons: shipped.filter((path) => PICTURE.test(path) && graph.files[path]?.dependency !== true),
          out,
          publicPath: moduleAddress(plugin.id, key, ''),
        });
    return { key, index };
  });

  const settle = (standing: Shown, prepared: Prepared): void => {
    if (shown.get(standing.plugin.id) !== standing) return;
    standing.prepared = prepared;
    if (prepared._tag === 'failed')
      faults.put(standing.plugin.id, POINT, `${NOT_COMPILED}: ${prepared.file === null ? '' : `${prepared.file}: `}${prepared.message}`);
    else faults.clear(standing.plugin.id, POINT);
    changed();
  };

  const run = (standing: Shown) =>
    prepare(standing).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.sync(() => settle(standing, { _tag: 'failed', message: failure.reason, file: failure.file })),
        onSuccess: ({ key, index }) =>
          Effect.andThen(
            Effect.sync(() => settle(standing, { _tag: 'ready', key, index })),
            sweep(standing.plugin.id, key).pipe(
              Effect.catch((failure) => Effect.logWarning('stale plugin view builds stay on disk', failure.message)),
            ),
          ),
      }),
    );

  const moduleOf = (plugin: string, view: string): ViewModule | undefined => {
    const standing = shown.get(plugin);
    const entry = standing?.views.find((candidate) => candidate.id === view)?.entry;
    if (standing === undefined || entry === undefined) return undefined;
    const { prepared } = standing;
    if (prepared._tag === 'preparing') return { state: 'preparing' };
    if (prepared._tag === 'failed') return { state: 'failed', message: prepared.message, file: prepared.file };
    const file = prepared.index.modules[entry];
    return file === undefined
      ? { state: 'failed', message: `the build made no module for ${entry}`, file: entry }
      : { state: 'ready', address: moduleAddress(plugin, prepared.key, file) };
  };

  const iconOf = (plugin: string, path: string): string | null => {
    const prepared = shown.get(plugin)?.prepared;
    const file = prepared?._tag === 'ready' ? prepared.index.icons[path] : undefined;
    return prepared?._tag === 'ready' && file !== undefined ? moduleAddress(plugin, prepared.key, file) : null;
  };

  const publish = Effect.fnUntraced(function* (plugin: PluginRef, views: ViewEntries) {
    const standing: Shown = { plugin, views, prepared: { _tag: 'preparing' }, candidates: [] };
    shown.set(plugin.id, standing);
    changed();
    yield* FiberMap.run(preparing, plugin.id, run(standing));
    return () => {
      if (shown.get(plugin.id) !== standing) return;
      shown.delete(plugin.id);
      const fiber = FiberMap.getUnsafe(preparing, plugin.id);
      if (Option.isSome(fiber)) fiber.value.interruptUnsafe();
      faults.clear(plugin.id, POINT);
      changed();
    };
  });

  return {
    publish,
    moduleOf,
    iconOf,
    candidates: (): ReadonlyMap<string, readonly string[]> => new Map([...shown].map(([id, standing]) => [id, standing.candidates])),
    files: ViewFiles.of({
      module: (plugin, key, file) => join(placeOf(plugin, key), file),
      sheet: (file) => join(home, 'sheet', file),
    }),
  };
});
