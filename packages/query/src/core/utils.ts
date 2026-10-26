import { CancelledError, type QueryClient, type QueryKey } from '@tanstack/query-core';

export function toUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('name' in error)) return false;
  return (error as { name: unknown }).name === 'AbortError';
}

export async function fetchFresh<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  refresh: boolean,
  fetch: () => Promise<TData>,
): Promise<TData> {
  const entry = () => queryClient.getQueryCache().find<TData>({ queryKey, exact: true });
  if (refresh) void entry()?.cancel({ silent: true });

  let pending = fetch();
  for (;;) {
    try {
      return await pending;
    } catch (error) {
      const replacement = error instanceof CancelledError && error.silent ? entry()?.promise : undefined;
      if (!replacement || replacement === pending) throw error;
      pending = replacement;
    }
  }
}

export function makeScopeKey(parts: readonly unknown[]): QueryKey {
  return parts as unknown as QueryKey;
}

export function defineHiddenGetters(target: object, getters: Record<string, () => unknown>): void {
  const descriptors: Record<string, PropertyDescriptor> = {};

  for (const [key, getter] of Object.entries(getters)) {
    descriptors[key] = {
      enumerable: false,
      get: getter,
    };
  }

  Object.defineProperties(target, descriptors);
}
