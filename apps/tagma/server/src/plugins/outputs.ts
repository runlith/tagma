import { Duration, Effect, FiberMap, FiberSet, Option, Queue, Stream } from 'effect';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { type TreeRescan, type TreeWatch, type WatchEvent, watchAll } from '../platform/watch/tree.js';
import type { PluginInstall } from './contract/wire/settings.js';
import type { Shelf } from './shelf.js';

const SETTLE = Duration.millis(300);
const POLL = Duration.seconds(5);
const LOST: ReadonlySet<TreeRescan> = new Set(['lost', 'error', 'polling']);
const PASSED_OVER: ReadonlySet<string> = new Set(['node_modules', '.git']);

type Owed = 'look' | 'rebuilt';

type Watched = {
  readonly root: string;
  declared: PluginInstall['declared'];
  watch: TreeWatch | null;
  outputs: ReadonlySet<string> | null;
  owed: Owed | null;
  passing: boolean;
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
  readonly rebuilt: (id: string) => Effect.Effect<void>;
}) {
  const { shelf, installs, rebuilt } = input;
  const watcher = yield* Effect.serviceOption(FileWatcher);
  const watched = new Map<string, Watched>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const held of watched.values()) held.watch?.close();
    }),
  );
  const pending = yield* FiberMap.make<string>();
  const passes = yield* FiberSet.make();
  const heard = yield* Effect.acquireRelease(Queue.unbounded<{ readonly id: string; readonly delay: Duration.Input }>(), Queue.shutdown);

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

  const passed = Effect.fn('PluginOutputs.pass')(
    function* (id: string, held: Watched) {
      let owed = held.owed;
      while (owed !== null && watched.get(id) === held) {
        held.owed = null;
        yield* opened(id, held);
        if (watched.get(id) !== held) {
          held.watch?.close();
          break;
        }
        held.outputs = yield* outputsOf(held);
        if (owed === 'rebuilt') yield* rebuilt(id);
        owed = held.owed;
      }
      held.passing = false;
    },
    (effect, _id, held) =>
      Effect.onInterrupt(effect, () =>
        Effect.sync(() => {
          held.passing = false;
        }),
      ),
  );

  const owe = (id: string, held: Watched, owed: Owed) =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        if (held.owed !== 'rebuilt') held.owed = owed;
        if (held.passing) return Effect.void;
        held.passing = true;
        return Effect.asVoid(FiberSet.run(passes, passed(id, held)));
      }),
    );

  let listed = false;
  const synced = Effect.fn('PluginOutputs.sync')(function* (listing: readonly PluginInstall[]) {
    const wanted = new Map(listing.map((install) => [install.id, install] as const));
    for (const [id, held] of watched) {
      const install = wanted.get(id);
      if (install?.root === held.root) {
        held.declared = install.declared;
        continue;
      }
      watched.delete(id);
      held.watch?.close();
      yield* FiberMap.remove(pending, id);
    }
    const owed: Owed = listed ? 'rebuilt' : 'look';
    listed = true;
    for (const [id, install] of wanted) {
      if (watched.has(id)) continue;
      const held: Watched = { root: install.root, declared: install.declared, watch: null, outputs: null, owed: null, passing: false };
      watched.set(id, held);
      yield* owe(id, held, owed);
    }
  });

  yield* Effect.forkScoped(Stream.runForEach(installs, synced));
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromQueue(heard), ({ id, delay }) =>
      FiberMap.run(
        pending,
        id,
        Effect.andThen(
          Effect.sleep(delay),
          Effect.suspend(() => {
            const held = watched.get(id);
            return held === undefined ? Effect.void : owe(id, held, 'rebuilt');
          }),
        ),
      ),
    ),
  );
});
