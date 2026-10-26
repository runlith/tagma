import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Duration, Effect, type Fiber, Semaphore } from 'effect';
import type { ChangeSource, ChangedPath } from '@runlith/agent-tools/changeSource';
import type { FileWatcher, WatchChange, WatchSubscription } from '../contract/service/watch.js';
import { excludedOf } from './tree.js';

const LINGER = Duration.minutes(5);

type Held = {
  ignore: readonly string[];
  subscription: WatchSubscription | null;
  count: number;
  lingering: Fiber.Fiber<void> | null;
  gone: boolean;
};

export const watchedChanges = Effect.fnUntraced(function* (watcher: FileWatcher['Service']) {
  const services = yield* Effect.context<never>();
  const turns = yield* Semaphore.make(1);
  const held = new Map<string, Held>();

  const close = (root: string, entry: Held): Effect.Effect<void> =>
    turns.withPermits(1)(
      Effect.suspend(() => {
        if (entry.count > 0 || held.get(root) !== entry) return Effect.void;
        held.delete(root);
        entry.gone = true;
        return entry.subscription?.close ?? Effect.void;
      }),
    );

  const release = (root: string, entry: Held) => (): void => {
    entry.count -= 1;
    if (entry.count > 0 || entry.gone) return;
    entry.lingering = Effect.runForkWith(services)(Effect.andThen(Effect.sleep(LINGER), close(root, entry)));
  };

  const subscribed = (root: string, entry: Held, ignore: readonly string[]) =>
    watcher.subscribe(
      root,
      { recursive: true, ignore },
      {
        heard: () => undefined,
        dropped: () => undefined,
        ended: () => {
          if (entry.ignore !== ignore) return;
          entry.gone = true;
          if (held.get(root) === entry) held.delete(root);
        },
      },
    );

  const excluded = (root: string) => excludedOf(root, existsSync(join(root, '.git', 'HEAD')));

  const opened = Effect.fnUntraced(function* (root: string) {
    const entry: Held = { ignore: yield* excluded(root), subscription: null, count: 0, lingering: null, gone: false };
    entry.subscription = yield* subscribed(root, entry, entry.ignore);
    return entry;
  });

  const rulesMoved = (root: string): Effect.Effect<void> =>
    turns.withPermits(1)(
      Effect.gen(function* () {
        const entry = held.get(root);
        if (entry === undefined || entry.gone) return;
        const ignore = yield* excluded(root);
        if (ignore.length === entry.ignore.length && ignore.every((one, at) => one === entry.ignore[at])) return;
        const fresh = yield* Effect.result(subscribed(root, entry, ignore));
        const stale = entry.subscription;
        entry.ignore = ignore;
        if (fresh._tag === 'Failure') {
          console.warn(
            `[watch] ${root} could not be watched under its new ignore rules, so snapshots read it whole: ${fresh.failure.message}`,
          );
          entry.gone = true;
          entry.subscription = null;
          held.delete(root);
        } else entry.subscription = fresh.success;
        if (stale !== null) yield* stale.close;
      }),
    );

  const hold = (root: string): Effect.Effect<() => void> =>
    turns.withPermits(1)(
      Effect.gen(function* () {
        const standing = held.get(root);
        const opening = standing !== undefined && !standing.gone ? null : yield* Effect.result(opened(root));
        if (opening !== null && opening._tag === 'Failure') return () => undefined;
        const entry = opening === null ? (standing as Held) : opening.success;
        held.set(root, entry);
        entry.lingering?.interruptUnsafe();
        entry.lingering = null;
        entry.count += 1;
        return release(root, entry);
      }),
    );

  const ignoreOf = (root: string): readonly string[] => held.get(root)?.ignore ?? [];

  const heardOf = (heard: WatchChange['heard']): ChangedPath['heard'] =>
    heard === undefined ? null : { from: heard.from - watcher.heardLateMs, to: heard.to };

  const source: ChangeSource = {
    hold,
    settle: (root) => watcher.settle(root, ignoreOf(root)).pipe(Effect.catchTag('WatchRefused', () => Effect.succeed(false))),
    mark: (root) => watcher.mark(root, null, ignoreOf(root), false).pipe(Effect.catchTag('WatchRefused', () => Effect.succeed(null))),
    changedSince: (root, position) =>
      watcher.changedSince(root, position, []).pipe(
        Effect.map((changes) => changes?.map((change): ChangedPath => ({ path: change.path, heard: heardOf(change.heard) })) ?? null),
        Effect.catchTag('WatchRefused', () => Effect.succeed(null)),
      ),
    rulesMoved,
  };
  return source;
});
