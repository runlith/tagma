import { Effect, Exit } from 'effect';
import type { FileWatcher, WatchChange, WatchSubscription } from '../contract/service/watch.js';

export type SharedListener = {
  readonly heard: (change: WatchChange) => void;
  readonly dropped: (subtree: string | null) => void;
  readonly failed: () => void;
};

export type SharedWatch = {
  readonly opened: Promise<boolean>;
  readonly release: () => Promise<void> | null;
};

type Shared = {
  readonly key: string;
  readonly listeners: Set<SharedListener>;
  readonly opened: PromiseWithResolvers<boolean>;
  readonly closed: PromiseWithResolvers<void>;
  state: 'opening' | 'open' | 'gone';
  subscription: WatchSubscription | null;
  released: boolean;
};

const tables = new WeakMap<FileWatcher['Service'], Map<string, Shared>>();

const tableOf = (watcher: FileWatcher['Service']): Map<string, Shared> => {
  const standing = tables.get(watcher);
  if (standing !== undefined) return standing;
  const made = new Map<string, Shared>();
  tables.set(watcher, made);
  return made;
};

export const sharedWatch = (
  watcher: FileWatcher['Service'],
  at: string,
  recursive: boolean,
  ignore: readonly string[],
  listener: SharedListener,
): SharedWatch => {
  const table = tableOf(watcher);
  const key = JSON.stringify([at, recursive, ignore]);

  const leave = (shared: Shared): WatchSubscription | null => {
    const subscription = shared.subscription;
    shared.state = 'gone';
    shared.subscription = null;
    if (table.get(shared.key) === shared) table.delete(shared.key);
    shared.opened.resolve(false);
    return subscription;
  };

  const gone = (shared: Shared): void => {
    leave(shared);
    shared.closed.resolve();
  };

  const shut = (shared: Shared): void => {
    const subscription = leave(shared);
    if (subscription === null) return shared.closed.resolve();
    void Effect.runPromise(subscription.close).then(shared.closed.resolve);
  };

  const open = (): Shared => {
    const shared: Shared = {
      key,
      listeners: new Set(),
      opened: Promise.withResolvers(),
      closed: Promise.withResolvers(),
      state: 'opening',
      subscription: null,
      released: false,
    };
    table.set(key, shared);
    const hearing = {
      heard: (changes: readonly WatchChange[]) => {
        if (shared.state === 'gone') return;
        for (const change of changes) for (const one of shared.listeners) one.heard(change);
      },
      dropped: (_reason: string, subtree: string | null) => {
        if (shared.state === 'gone') return;
        for (const one of shared.listeners) one.dropped(subtree);
      },
      ended: () => {
        if (shared.state === 'gone') return;
        const failed = shared.state === 'open';
        gone(shared);
        if (failed) for (const one of shared.listeners) one.failed();
      },
    };
    void Effect.runPromiseExit(watcher.subscribe(at, { recursive, ignore }, hearing)).then((exit) => {
      if (Exit.isFailure(exit)) return gone(shared);
      if (shared.state === 'gone') return void Effect.runPromise(exit.value.close);
      shared.subscription = exit.value;
      shared.state = 'open';
      shared.opened.resolve(true);
      if (shared.released) shut(shared);
    });
    return shared;
  };

  const shared = table.get(key) ?? open();
  shared.listeners.add(listener);
  let held = true;
  return {
    opened: shared.opened.promise,
    release: () => {
      if (!held) return null;
      held = false;
      shared.listeners.delete(listener);
      if (shared.listeners.size > 0 || shared.released) return null;
      shared.released = true;
      if (table.get(key) === shared) table.delete(key);
      if (shared.state === 'gone') return null;
      if (shared.state === 'open') shut(shared);
      return shared.closed.promise;
    },
  };
};
