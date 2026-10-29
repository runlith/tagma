import {
  type QueryClient,
  QueryObserver,
  hashKey,
  isCancelledError,
  type DefaultError,
  type FetchQueryOptions,
  type FetchStatus,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
  type QueryStatus,
  isServer,
} from '@tanstack/query-core';
import type { Scope } from '@runlith/layer/Scope';

import { createSubscriber } from 'svelte/reactivity';

import { deliver } from './core/deliver.svelte.js';
import { defineHiddenGetters, fetchFresh, isAbortError, toUndefined } from './core/utils.js';
import type { BaseQueryOptions, BaseQuery, QueryLoadOptions } from './types.js';

type QueryConfig<TData, TError> = {
  scope: Scope;
  queryClient: QueryClient;
  queryKey: QueryKey;
  queryFn: QueryObserverOptions<TData, TError, TData, TData, QueryKey>['queryFn'];
  options: BaseQueryOptions;
};

export function createQuery<TData, TError = DefaultError>(config: QueryConfig<TData, TError>): BaseQuery<TData, TError> {
  const { scope, queryClient, queryKey } = config;

  let observer: QueryObserver<TData, TError, TData, TData, QueryKey> | undefined;
  let result: QueryObserverResult<TData, TError> | undefined;
  let changed: (() => void) | undefined;
  let subscription: VoidFunction | undefined;
  let cacheSubscription: VoidFunction | undefined;
  let observationToken = 0;
  let observed = false;
  // A live query is its own reader in the browser from its first use to the end of its scope; a server render never polls.
  const live = config.options.live === true && !isServer;
  const isHeld = () => observed || live;
  let query: BaseQuery<TData, TError>;

  const { staleTime, retry, gcTime } = config.options;

  const observerOptions: QueryObserverOptions<TData, TError, TData, TData, QueryKey> = {
    queryKey,
    queryFn: config.queryFn,
    ...(gcTime === undefined ? {} : { gcTime }),
    ...(config.options.refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus: config.options.refetchOnWindowFocus }),
    ...(config.options.refetchOnReconnect === undefined ? {} : { refetchOnReconnect: config.options.refetchOnReconnect }),
    ...(config.options.enabled === undefined ? {} : { enabled: config.options.enabled }),
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(retry === undefined ? {} : { retry }),
    ...(config.options.refetchInterval === undefined ? {} : { refetchInterval: config.options.refetchInterval }),
  };

  const sync = (current = observer) => {
    if (!current || current !== observer) return;
    result = current.getCurrentResult();
    changed?.();
  };

  const view = () => {
    if (result) {
      return {
        data: result.data,
        error: result.error,
        status: result.status,
        fetchStatus: result.fetchStatus,
        isStale: result.isStale,
      };
    }

    const query = queryClient.getQueryCache().find<TData, TError>({ queryKey, exact: true });
    if (!query) {
      return { data: undefined, error: null, status: 'pending' as QueryStatus, fetchStatus: 'idle' as FetchStatus, isStale: true };
    }

    return {
      data: query.state.data,
      error: query.state.error,
      status: query.state.status,
      fetchStatus: query.state.fetchStatus,
      isStale: query.isStale(),
    };
  };

  const scheduleSync = (current = observer) => {
    if (!current) return;
    queueMicrotask(() => sync(current));
  };

  const ensureObserver = () => {
    if (scope.closed) return undefined;

    if (!observer) {
      observer = new QueryObserver<TData, TError, TData, TData, QueryKey>(queryClient, observerOptions);
    } else {
      observer.setOptions(observerOptions);
    }

    sync(observer);
    return observer;
  };

  const queryHash = hashKey(queryKey);
  const pending = () => queryClient.getQueryCache().get<TData, TError>(queryHash)?.promise;

  const buildFetchOptions = (options?: QueryLoadOptions): FetchQueryOptions<TData, TError, TData, QueryKey> => {
    const resolvedStaleTime = options?.refresh === true ? 0 : staleTime;

    return {
      queryKey,
      queryFn: config.queryFn,
      ...(gcTime === undefined ? {} : { gcTime }),
      ...(resolvedStaleTime === undefined ? {} : { staleTime: resolvedStaleTime }),
      ...(retry === undefined ? {} : { retry }),
    };
  };

  const releaseObserver = () => {
    observationToken += 1;
    subscription?.();
    subscription = undefined;
    cacheSubscription?.();
    cacheSubscription = undefined;
    observer?.destroy();
    observer = undefined;
    result = undefined;
    changed?.();
  };

  const startObservation = () => {
    observationToken += 1;
    const current = ensureObserver();
    if (!current) return;

    if (!subscription) {
      subscription = current.subscribe(() => scheduleSync(current));
      cacheSubscription = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'removed') return;
        if (event.query.queryHash !== current.getCurrentQuery().queryHash) return;

        queueMicrotask(() => {
          if (scope.closed || !isHeld() || observer !== current) return;
          current.setOptions(observerOptions);
          sync(current);
        });
      });
    }

    scheduleSync(current);
  };

  const stopObservation = () => {
    const current = observer;
    const token = ++observationToken;
    const inFlight = current?.getCurrentQuery().promise;
    if (inFlight) {
      queryClient.mount();
      void inFlight.finally(() => queryClient.unmount()).catch(() => undefined);
    }

    queueMicrotask(() => {
      if (scope.closed || isHeld() || observationToken !== token || observer !== current) return;

      if (inFlight) {
        void inFlight
          .finally(() => {
            queueMicrotask(() => {
              if (scope.closed || isHeld() || observationToken !== token || observer !== current) return;
              releaseObserver();
            });
          })
          .catch(() => undefined);
        return;
      }

      releaseObserver();
    });
  };

  const cacheVersion = createSubscriber((update) => {
    const hash = hashKey(queryKey);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === hash) deliver(update);
    });
  });

  const autoAttach = createSubscriber((update) => {
    changed = update;
    observed = true;
    queryClient.mount();
    startObservation();
    return () => {
      changed = undefined;
      observed = false;
      queryClient.unmount();
      stopObservation();
    };
  });

  const fetchAndSync = async (options?: QueryLoadOptions): Promise<TData | undefined> => {
    if (scope.closed) return undefined;

    const throwOnError = options?.throwOnError ?? false;
    queryClient.mount();

    try {
      const value = await fetchFresh(queryClient, queryKey, options?.refresh === true, () =>
        queryClient.fetchQuery(buildFetchOptions(options)),
      );
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
      return value;
    } catch (error) {
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }

      if (isCancelledError(error) || isAbortError(error)) return undefined;
      if (throwOnError) throw error;
      return undefined;
    } finally {
      queryClient.unmount();
    }
  };

  type QueryCore = Omit<
    BaseQuery<TData, TError>,
    'data' | 'error' | 'isPending' | 'isLoading' | 'isFetching' | 'isSuccess' | 'isError' | 'isStale' | 'promise' | 'status' | 'fetchStatus'
  >;

  const queryCore = {
    async load(options) {
      return await fetchAndSync(options);
    },
    async loadOrThrow(options?: Omit<QueryLoadOptions, 'throwOnError'>) {
      return await fetchAndSync({ ...options, throwOnError: true });
    },
    async refresh(options?: Omit<QueryLoadOptions, 'refresh'>) {
      return await fetchAndSync({ refresh: true, ...options });
    },
    watchError() {
      cacheVersion();
      return toUndefined(queryClient.getQueryState(queryKey)?.error) as TError | undefined;
    },
    watchFetching() {
      cacheVersion();
      return queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching';
    },
    watch() {
      cacheVersion();
      return queryClient.getQueryData(queryKey) as TData | undefined;
    },
    reset() {
      if (scope.closed) return;
      void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => undefined);
      queryClient.removeQueries({ queryKey, exact: true });
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
    },
    async cancel() {
      if (scope.closed) return;
      await queryClient.cancelQueries({ queryKey, exact: true }).catch(() => undefined);
    },
    async invalidate(options) {
      if (scope.closed) return;
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: options?.refetchType }).catch(() => undefined);
    },
    setCache(valueOrUpdater) {
      if (scope.closed) return;
      queryClient.setQueryData(queryKey, valueOrUpdater);
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
    },
  } satisfies QueryCore;

  query = queryCore as BaseQuery<TData, TError>;

  scope.defer(() => {
    releaseObserver();
    queryClient.removeQueries({ queryKey, exact: true });
  });

  if (live && !scope.closed) {
    queryClient.mount();
    scope.defer(() => queryClient.unmount());
    startObservation();
  }

  const ensureObserved = () => {
    if (scope.closed) return;
    autoAttach();
  };

  defineHiddenGetters(query, {
    promise: () => {
      scope.assertOpen();
      autoAttach();

      const held = pending();
      if (held) return held;

      const fetchPromise = queryClient.fetchQuery(buildFetchOptions());
      return pending() ?? fetchPromise;
    },
    data: () => {
      ensureObserved();
      return view().data;
    },
    error: () => {
      ensureObserved();
      return toUndefined(view().error) as TError | undefined;
    },
    isPending: () => {
      ensureObserved();
      return view().status === 'pending';
    },
    isLoading: () => {
      ensureObserved();
      const current = view();
      return current.status === 'pending' && current.fetchStatus === 'fetching';
    },
    isFetching: () => {
      ensureObserved();
      return view().fetchStatus === 'fetching';
    },
    isSuccess: () => {
      ensureObserved();
      return view().status === 'success';
    },
    isError: () => {
      ensureObserved();
      return view().status === 'error';
    },
    isStale: () => {
      ensureObserved();
      return view().isStale;
    },
    status: () => {
      ensureObserved();
      return view().status;
    },
    fetchStatus: () => {
      ensureObserved();
      return view().fetchStatus;
    },
  });

  return query;
}
