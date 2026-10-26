import type { QueryClient } from '@tanstack/query-core';
import { Layer } from '@runlith/layer/Layer';
import type { AnyKeyClass, AnySelfMadeKeyClass, InstanceOf, SelfMadeKeyClass } from '@runlith/layer/key';
import type { AnyRung } from '@runlith/layer/Rung';
import { test as mountApp, type At } from '@runlith/layer/svelte/test.svelte';
import { withOverrides } from '@runlith/testing/overrides';

import { Cache } from './repo.js';

export type QueryStub = Record<string, unknown>;

export function stubQuery(overrides?: QueryStub) {
  const stub = withOverrides(
    {
      data: undefined,
      error: undefined,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isSuccess: false,
      isError: false,
      isStale: false,
      status: 'pending',
      fetchStatus: 'idle',
      promise: Promise.resolve(undefined),
      load: async () => undefined,
      loadOrThrow: async () => undefined,
      refresh: async () => undefined,
      watch: () => undefined,
      watchError: () => undefined,
      watchFetching: () => false,
      reset: () => undefined,
      cancel: async () => undefined,
      invalidate: async () => undefined,
      setCache: () => undefined,
    },
    overrides,
  );

  return bindWatch(stub, overrides);
}

function bindWatch<TStub extends object>(stub: TStub, overrides?: QueryStub): TStub {
  if (!(overrides && Object.prototype.hasOwnProperty.call(overrides, 'watch'))) {
    Object.defineProperty(stub, 'watch', { value: () => (stub as { data?: unknown }).data, enumerable: true });
  }
  if (!(overrides && Object.prototype.hasOwnProperty.call(overrides, 'watchError'))) {
    Object.defineProperty(stub, 'watchError', { value: () => (stub as { error?: unknown }).error, enumerable: true });
  }
  if (!(overrides && Object.prototype.hasOwnProperty.call(overrides, 'watchFetching'))) {
    Object.defineProperty(stub, 'watchFetching', {
      value: () => Boolean((stub as { isFetching?: unknown }).isFetching),
      enumerable: true,
    });
  }
  return stub;
}

export function stubAll() {
  return {
    reset: () => undefined,
    cancel: async () => undefined,
    invalidate: async () => undefined,
  };
}

export function stubSingle(overrides?: QueryStub) {
  return bindWatch(
    withOverrides(
      {
        ...stubQuery(),
        name: 'stub',
        page: () => ({ ...stubQuery(), page: 1 }),
        inf: () => stubInf(),
        all: stubAll,
      },
      overrides,
    ),
    overrides,
  );
}

export function stubFamily(query?: QueryStub) {
  return {
    name: 'stub',
    key: () => ({ ...stubSingle(query), key: undefined }),
    all: stubAll,
    reset: () => undefined,
  };
}

export function stubInf(overrides?: QueryStub) {
  return withOverrides(
    {
      ...stubQuery(),
      fetchNextPage: async () => undefined,
      fetchPreviousPage: async () => undefined,
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingNextPage: false,
      isFetchingPreviousPage: false,
    },
    overrides,
  );
}

export function stubMutation(run: (...args: never[]) => Promise<unknown> = async () => ({ success: true })) {
  return {
    data: undefined,
    error: undefined,
    pending: false,
    status: 'idle',
    run,
    reset: () => undefined,
    in() {
      return this;
    },
  };
}

export function mountRepo<Self, Door extends AnyKeyClass, const L extends readonly AnyRung[] = readonly []>(
  key: SelfMadeKeyClass<string, Self> & { readonly door: Door },
  deps: { door: InstanceOf<Door>; queryClient: QueryClient; ladder?: L; at?: At<L> },
): { repo: Self; unmount: () => Promise<void> } {
  const app = mountApp(
    Layer.mergeAll(key as AnySelfMadeKeyClass),
    Layer.mergeAll(Layer.of(key.door, deps.door as never), Layer.of(Cache, deps.queryClient)) as never,
    { ladder: deps.ladder, at: deps.at },
  );

  return { repo: app.get(key), unmount: () => app.unmount() };
}
