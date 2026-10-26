import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Exit, Queue, Scope, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { locationsAt } from '@runlith/git/repository';
import { actingGit } from '../../platform/git/ownGit.js';
import { mayReference, mayTouch, type WatchEvent, watchAll } from '../../platform/watch/tree.js';
import type { CheckoutsMoved } from '../contract/service/checkouts.js';

const REOPEN_MS = 2_000;
const REOPEN_CEILING_MS = 60_000;

const HEAD = 'HEAD';
const LINKED = 'worktrees';
const PACKED = 'packed-refs';
const MARKS: ReadonlySet<string> = new Set([HEAD, 'gitdir', 'locked']);

type Listener = (moved: CheckoutsMoved) => void;

type Watched = {
  readonly listeners: Set<Listener>;
  readonly scope: Scope.Closeable;
  watching: boolean;
};

type Heard = 'moved' | 'linked' | 'lost';

const linkedMoved = (event: WatchEvent): boolean =>
  event.paths === undefined ||
  event.paths.length === 0 ||
  event.paths.some((path) => {
    const parts = path.split('/');
    return parts.length === 1 || (parts.length === 2 && MARKS.has(parts[1]!));
  });

const lost = (event: WatchEvent): boolean => 'rescan' in event && (event.rescan === 'lost' || event.rescan === 'error');

export type TopologyWatches = Effect.Success<typeof makeTopologyWatches>;

export const makeTopologyWatches = Effect.gen(function* () {
  const git = actingGit(yield* Git, 'checkouts-moved');
  const scope = yield* Effect.scope;

  const watched = new Map<string, Watched>();

  const tell = (root: string, entry: Watched): void => {
    const moved = { root, watching: entry.watching };
    for (const listener of entry.listeners) listener(moved);
  };

  const moved = (root: string): Stream.Stream<CheckoutsMoved> =>
    Stream.callback<CheckoutsMoved>(
      (queue) =>
        Effect.acquireRelease(
          enter(root, (event) => void Queue.offerUnsafe(queue, event)),
          (listener) => leave(root, listener),
        ),
      { bufferSize: 1, strategy: 'sliding' },
    );

  const enter = Effect.fn('checkouts.enter')(function* (root: string, listener: Listener): Effect.fn.Return<Listener> {
    const standing = watched.get(root);
    if (standing !== undefined) {
      standing.listeners.add(listener);
      listener({ root, watching: standing.watching });
      return listener;
    }
    const entry: Watched = { listeners: new Set([listener]), scope: Scope.forkUnsafe(scope), watching: false };
    watched.set(root, entry);
    listener({ root, watching: false });
    yield* observe(root, entry).pipe(Effect.forkIn(entry.scope));
    return listener;
  });

  function leave(root: string, listener: Listener): Effect.Effect<void> {
    return Effect.suspend(() => {
      const standing = watched.get(root);
      if (standing === undefined) return Effect.void;
      standing.listeners.delete(listener);
      if (standing.listeners.size > 0) return Effect.void;
      watched.delete(root);
      return Scope.close(standing.scope, Exit.void);
    });
  }

  const watch = Effect.fnUntraced(function* (root: string, entry: Watched) {
    const common = (yield* locationsAt(git, root)).commonDir;
    const linked = yield* Effect.promise(() =>
      access(join(common, LINKED)).then(
        () => true,
        () => false,
      ),
    );
    const heard = yield* Queue.sliding<Heard>(4);
    const offer = (what: Heard) => void Queue.offerUnsafe(heard, what);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const watching = yield* Effect.acquireRelease(
          watchAll([
            {
              at: common,
              recursive: false,
              required: true,
              listen: (event) => {
                if (lost(event)) return offer('lost');
                if (!linked && mayTouch(event, LINKED)) offer('linked');
                else if (mayTouch(event, HEAD) || mayTouch(event, PACKED)) offer('moved');
              },
            },
            {
              at: join(common, LINKED),
              recursive: true,
              listen: (event) => {
                if (lost(event)) return offer('lost');
                if (linkedMoved(event)) offer('moved');
              },
            },
            {
              at: join(common, 'refs', 'heads'),
              recursive: true,
              listen: (event) => {
                if (lost(event)) return offer('lost');
                if (mayReference(event)) offer('moved');
              },
            },
          ]),
          (opened) => Effect.sync(() => opened.close()),
        );
        entry.watching = watching.watching();
        tell(root, entry);
        if (!entry.watching) return false;
        for (;;) {
          const next = yield* Queue.take(heard);
          if (next === 'lost' || !watching.watching()) return false;
          tell(root, entry);
          if (next === 'linked') return true;
        }
      }),
    );
  });

  const observe = Effect.fnUntraced(function* (root: string, entry: Watched): Effect.fn.Return<void> {
    let wait = REOPEN_MS;
    for (;;) {
      const ran = yield* Effect.exit(watch(root, entry));
      if (Exit.isFailure(ran))
        yield* Effect.logWarning('the checkouts of a repository could not be watched, so their moves are not promised until it opens', {
          root,
          cause: ran.cause,
        });
      entry.watching = false;
      tell(root, entry);
      if (Exit.isSuccess(ran) && ran.value) {
        wait = REOPEN_MS;
        continue;
      }
      yield* Effect.sleep(wait);
      wait = Math.min(wait * 2, REOPEN_CEILING_MS);
    }
  });

  return { moved };
});
