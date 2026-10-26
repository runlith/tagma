import { flushSync } from 'svelte';
import type { QueryClient, QueryKey } from '@tanstack/query-core';

export function observe(read: () => unknown): () => void {
  const stop = $effect.root(() => {
    $effect(() => {
      void read();
    });
  });
  flushSync();
  return stop;
}

export function observeDerived<T>(read: () => T): { readonly latest: () => T | undefined; readonly stop: () => void } {
  let latest: T | undefined;
  const stop = $effect.root(() => {
    const value = $derived.by(read);
    $effect(() => {
      latest = value;
    });
  });
  flushSync();
  return { latest: () => latest, stop };
}

export function observersCount(queryClient: QueryClient, queryKey: QueryKey): number {
  return queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0;
}
