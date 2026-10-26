import { flushSync, mount, unmount, type Component } from 'svelte';

import { flush } from './flush.js';
import StoreHost from './StoreHost.svelte';

type StoreHostProps<T> = { create: () => T; onReady: (store: T) => void };

export type MountedStore<T> = {
  store: T;
  unmount: () => Promise<void>;
};

export async function mountStore<T>(create: () => T): Promise<MountedStore<T>> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  let store: T | undefined;

  const host = StoreHost as Component<StoreHostProps<T>>;

  const app = mount(host, {
    target,
    props: {
      create,
      onReady: (next: T) => {
        store = next;
      },
    },
  });

  await flush();
  if (store === undefined) throw new Error('StoreHost did not call onReady');

  return {
    store,
    unmount: async () => {
      await unmount(app);
      target.remove();
    },
  };
}

export type MountedStoreSync<T> = {
  store: T;
  unmount: () => void;
};

export function mountStoreSync<T>(create: () => T): MountedStoreSync<T> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  let store: T | undefined;

  const host = StoreHost as Component<StoreHostProps<T>>;

  const app = mount(host, {
    target,
    props: {
      create,
      onReady: (next: T) => {
        store = next;
      },
    },
  });

  flushSync();
  if (store === undefined) throw new Error('StoreHost did not call onReady');

  return {
    store,
    unmount: () => {
      void unmount(app);
      flushSync();
      target.remove();
    },
  };
}
