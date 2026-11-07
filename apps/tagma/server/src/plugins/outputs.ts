import { Duration, Effect, FiberMap, Option, Queue, Stream } from 'effect';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { type TreeRescan, type TreeWatch, type WatchEvent, watchAll } from '../platform/watch/tree.js';
import type { PluginInstall } from './contract/wire/settings.js';
import type { Shelf } from './shelf.js';

const SETTLE = Duration.millis(300);
const POLL = Duration.seconds(5);
const LOST: ReadonlySet<TreeRescan> = new Set(['lost', 'error', 'polling']);
const PASSED_OVER: ReadonlySet<string> = new Set(['node_modules', '.git']);

type Watched = {
  readonly root: string;
  declared: PluginInstall['declared'];
  watch: TreeWatch | null;
  outputs: ReadonlySet<string> | null;
};

const touches = (outputs: ReadonlySet<string> | null, path: string): boolean => {
  if (outputs === null) return !path.split('/').some((part) => PASSED_OVER.has(part));
  if (path === '' || outputs.has(path)) return true;
  for (const output of outputs) if (output.startsWith(`${path}/`)) return true;
  return false;
};

export const makeOutputs = Effect.fnUntraced(function* (input: {
  readonly shelf: Shelf;
  readonly installs: Stream.Stream<readonly PluginInstall[]>;
  readonly touched: (id: string) => Effect.Effect<void>;
}) {
  const { shelf, installs, touched } = input;
  const watcher = yield* Effect.serviceOption(FileWatcher);
  const pending = yield* FiberMap.make<string>();
  const heard = yield* Effect.acquireRelease(Queue.unbounded<{ readonly id: string; readonly delay: Duration.Input }>(), Queue.shutdown);
  const watched = new Map<string, Watched>();

  const listen = (id: string) => (event: WatchEvent) => {
    const held = watched.get(id);
    if (held === undefined) return;
    const named = event.paths ?? [];
    if ('rescan' in event && (event.rescan !== 'rename' || named.length === 0)) {
      Queue.offerUnsafe(heard, { id, delay: LOST.has(event.rescan) ? POLL : SETTLE });
      return;
    }
    if (named.some((path) => touches(held.outputs, path))) Queue.offerUnsafe(heard, { id, delay: SETTLE });
  };

  const outputsOf = (held: Watched) =>
    Effect.match(shelf.read(held.root, held.declared ?? null), {
      onFailure: () => null,
      onSuccess: (read) => (read.package.build === null ? null : new Set(read.package.build.outputs)),
    });

  const opened = Effect.fn('PluginOutputs.watch')(function* (id: string, held: Watched) {
    if (held.watch?.watching() === true) return;
    held.watch?.close();
    const opening = watchAll([{ at: held.root, recursive: true, required: true, listen: listen(id) }]);
    held.watch = yield* Option.isSome(watcher) ? Effect.provideService(opening, FileWatcher, watcher.value) : opening;
    if (!held.watch.watching()) yield* Queue.offer(heard, { id, delay: POLL });
  });

  const settled = Effect.fn('PluginOutputs.settled')(function* (id: string) {
    const held = watched.get(id);
    if (held === undefined) return;
    yield* opened(id, held);
    held.outputs = yield* outputsOf(held);
    yield* touched(id);
  });

  const synced = Effect.fn('PluginOutputs.sync')(function* (listed: readonly PluginInstall[]) {
    const wanted = new Map(listed.map((install) => [install.id, install] as const));
    for (const [id, held] of watched) {
      const install = wanted.get(id);
      if (install?.root === held.root) {
        held.declared = install.declared;
        continue;
      }
      held.watch?.close();
      watched.delete(id);
      yield* FiberMap.remove(pending, id);
    }
    for (const [id, install] of wanted) {
      if (watched.has(id)) continue;
      const held: Watched = { root: install.root, declared: install.declared, watch: null, outputs: null };
      watched.set(id, held);
      held.outputs = yield* outputsOf(held);
      yield* opened(id, held);
    }
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const held of watched.values()) held.watch?.close();
    }),
  );
  yield* Effect.forkScoped(Stream.runForEach(installs, synced));
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromQueue(heard), ({ id, delay }) =>
      FiberMap.run(pending, id, Effect.sleep(delay).pipe(Effect.andThen(settled(id)))),
    ),
  );
});
